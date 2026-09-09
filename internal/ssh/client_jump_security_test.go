package ssh

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh/testutil"
)

func rejectJumpTestSession(_ *jumpTestServer, channel gossh.NewChannel, _ <-chan struct{}) {
	_ = channel.Reject(gossh.UnknownChannelType, "unsupported")
}

func TestConnectViaJumpHostTargetAuthentication(t *testing.T) {
	for _, password := range []string{"target-secret", "wrong-secret", ""} {
		t.Run(password, func(t *testing.T) {
			target := newJumpTestEndpoint(t, newJumpServerConfig(t, "target-secret"), rejectJumpTestSession)
			server := newJumpTestServer(t, jumpServerOptions{target: target.address})
			jump := connectTestJump(t, server)
			var auth []gossh.AuthMethod
			if password != "" {
				auth = []gossh.AuthMethod{gossh.Password(password)}
			}
			client, err := ConnectViaJumpHost(t.Context(), model.Session{
				Host: "private.target.invalid", Port: 22, Username: "target", KeepAlive: 1,
			}, JumpHostConnectOptions{
				JumpHost: jump, Auth: auth, KnownHostsPath: testutil.KnownHostsPath(t),
				HostKey: HostKeyOptions{Policy: HostKeyPolicyTrust}, Logger: slog.Default(),
			})
			if password == "target-secret" {
				require.NoError(t, err)
				require.NoError(t, client.Close())
			} else {
				require.ErrorContains(t, err, "unable to authenticate")
				assert.Nil(t, client)
			}
			waitJumpSignal(t, jump.Done())
			waitJumpSignal(t, server.closed)
			waitJumpSignal(t, target.closed)
		})
	}
}

func TestConnectViaJumpHostUsesTargetPublicKeyAuthentication(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	signer, err := gossh.NewSignerFromKey(privateKey)
	require.NoError(t, err)
	config := newJumpServerConfig(t, "")
	config.NoClientAuth = false
	config.PublicKeyCallback = func(meta gossh.ConnMetadata, key gossh.PublicKey) (*gossh.Permissions, error) {
		if meta.User() != "target" || !bytes.Equal(signer.PublicKey().Marshal(), key.Marshal()) {
			return nil, errors.New("invalid target identity")
		}
		return nil, nil
	}
	target := newJumpTestEndpoint(t, config, rejectJumpTestSession)
	server := newJumpTestServer(t, jumpServerOptions{target: target.address})
	jump := connectTestJump(t, server)
	client, err := ConnectViaJumpHost(t.Context(), model.Session{
		Host: "private.target.invalid", Port: 22, Username: "target",
	}, JumpHostConnectOptions{
		JumpHost: jump, Auth: []gossh.AuthMethod{gossh.PublicKeys(signer)}, KnownHostsPath: testutil.KnownHostsPath(t),
		HostKey: HostKeyOptions{Policy: HostKeyPolicyTrust},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })
	_, _, err = client.Inner.SendRequest("authenticated", true, nil)
	require.NoError(t, err)
}

func TestConnectViaJumpHostVerifiesBothEndpoints(t *testing.T) {
	target := newJumpTestEndpoint(t, newJumpServerConfig(t, ""), rejectJumpTestSession)
	server := newJumpTestServer(t, jumpServerOptions{target: target.address})
	knownHosts := testutil.KnownHostsPath(t)
	var verifiedHosts, verifiedKeys []string
	verify := func(host, _ string, fingerprint string) bool {
		verifiedHosts = append(verifiedHosts, host)
		verifiedKeys = append(verifiedKeys, fingerprint)
		return true
	}
	jump, err := ConnectWithVerifier(t.Context(), model.Session{
		Host: "127.0.0.1", Port: mustParsePort(server.address), Username: "jump",
	}, nil, knownHosts, verify, slog.Default())
	require.NoError(t, err)
	t.Cleanup(func() { _ = jump.Close() })
	client, err := ConnectViaJumpHost(t.Context(), model.Session{
		Host: "private.target.invalid", Port: 22, Username: "target",
	}, JumpHostConnectOptions{
		JumpHost: jump, KnownHostsPath: knownHosts, HostKey: HostKeyOptions{OnNewHostKey: verify},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })
	assert.Equal(t, []string{server.address, "private.target.invalid:22"}, verifiedHosts)
	require.Len(t, verifiedKeys, 2)
	assert.NotEqual(t, verifiedKeys[0], verifiedKeys[1])
}

func TestConnectViaJumpHostRejectsChangedTargetFingerprint(t *testing.T) {
	target := newJumpTestEndpoint(t, newJumpServerConfig(t, ""), rejectJumpTestSession)
	server := newJumpTestServer(t, jumpServerOptions{target: target.address})
	jump := connectTestJump(t, server)
	knownHosts := testutil.KnownHostsPath(t)
	previousKey := newTestPublicKey(t)
	require.NoError(t, appendKnownHost(knownHosts, "private.target.invalid:22", previousKey))
	client, err := ConnectViaJumpHost(t.Context(), model.Session{
		Host: "private.target.invalid", Port: 22, Username: "target",
	}, JumpHostConnectOptions{JumpHost: jump, KnownHostsPath: knownHosts})
	require.ErrorContains(t, err, "changed")
	assert.ErrorContains(t, err, gossh.FingerprintSHA256(previousKey))
	assert.Nil(t, client)
	waitJumpSignal(t, jump.Done())
	waitJumpSignal(t, target.closed)
}

func TestConnectViaJumpHostInvalidOptionsCloseJump(t *testing.T) {
	for _, reason := range []string{"missing context", "missing known hosts", "closed jump"} {
		t.Run(reason, func(t *testing.T) {
			server := newJumpTestServer(t, jumpServerOptions{reject: true})
			jump := connectTestJump(t, server)
			var ctx context.Context = t.Context()
			path := testutil.KnownHostsPath(t)
			switch reason {
			case "missing context":
				ctx = nil
			case "missing known hosts":
				path = ""
			case "closed jump":
				require.NoError(t, jump.Close())
			}
			client, err := ConnectViaJumpHost(ctx, model.Session{Host: "private.target.invalid", Port: 22}, JumpHostConnectOptions{
				JumpHost: jump, KnownHostsPath: path,
			})
			require.Error(t, err)
			assert.Nil(t, client)
			waitJumpSignal(t, jump.Done())
			waitJumpSignal(t, server.closed)
		})
	}
}

func TestConnectViaJumpHostRequiresJumpClient(t *testing.T) {
	for _, jump := range []*ClientWrapper{nil, newClientWrapper(nil, nil)} {
		client, err := ConnectViaJumpHost(t.Context(), model.Session{}, JumpHostConnectOptions{JumpHost: jump})
		require.ErrorContains(t, err, "SSH jump host is unavailable")
		assert.Nil(t, client)
		if jump != nil {
			waitJumpSignal(t, jump.Done())
		}
	}
}
