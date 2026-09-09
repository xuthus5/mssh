package ssh

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh/testutil"
)

type confirmedConnection struct {
	client *ClientWrapper
	err    error
}

func TestConnectAllowsHostKeyConfirmationPastNetworkTimeout(t *testing.T) {
	address, stop := testutil.NewMockServer(t)
	t.Cleanup(stop)
	ctx, cancel := context.WithTimeout(t.Context(), 2*sshConnectTimeout)
	t.Cleanup(cancel)
	session := model.Session{Host: "127.0.0.1", Port: mustParsePort(address), Username: "test"}
	knownHostsPath := testutil.KnownHostsPath(t)
	started := make(chan struct{})
	var confirmations atomic.Int32
	confirm := func(_, _, _ string) bool {
		if confirmations.Add(1) == 1 {
			close(started)
		}
		select {
		case <-time.After(sshConnectTimeout + 100*time.Millisecond):
			return true
		case <-ctx.Done():
			return false
		}
	}
	results := make(chan confirmedConnection, 2)
	connect := func() {
		client, err := ConnectWithVerifier(ctx, session, nil, knownHostsPath, confirm, slog.Default())
		results <- confirmedConnection{client: client, err: err}
	}
	go connect()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("host key confirmation did not start")
	}
	go connect()
	waitForConfirmedConnections(t, results, 2)
	assert.Equal(t, int32(1), confirmations.Load())
}

func waitForConfirmedConnections(t *testing.T, results <-chan confirmedConnection, count int) {
	t.Helper()
	for range count {
		select {
		case result := <-results:
			if result.client != nil {
				t.Cleanup(func() { require.NoError(t, result.client.Close()) })
			}
			require.NoError(t, result.err)
			require.NotNil(t, result.client)
		case <-time.After(2 * sshConnectTimeout):
			t.Fatal("connection did not complete after host key confirmation")
		}
	}
}

func TestEstablishHandshakeDeadlineErrorsCloseConnection(t *testing.T) {
	tests := []struct {
		failAt int
		stage  string
	}{
		{failAt: 1, stage: "set handshake deadline"},
		{failAt: 2, stage: "pause handshake deadline"},
		{failAt: 3, stage: "resume handshake deadline"},
		{failAt: 4, stage: "clear handshake deadline"},
	}
	for _, test := range tests {
		t.Run(test.stage, func(t *testing.T) {
			address, conn := dialHandshakeTestServer(t)
			conn.failAt = test.failAt
			conn.deadlineErr = errors.New("cannot set deadline")
			config := &gossh.ClientConfig{User: "test", HostKeyCallback: func(_ string, _ net.Addr, _ gossh.PublicKey) error { return nil }}
			_, _, _, err := establishSSHConnection(t.Context(), conn, address, config)
			require.ErrorIs(t, err, conn.deadlineErr)
			assert.ErrorContains(t, err, test.stage)
			_, writeErr := conn.Write([]byte("closed"))
			require.ErrorIs(t, writeErr, net.ErrClosed)
		})
	}
}

func TestEstablishHandshakeRejectsUntrustedHostKey(t *testing.T) {
	address, conn := dialHandshakeTestServer(t)
	verificationErr := errors.New("host key rejected")
	config := &gossh.ClientConfig{User: "test", HostKeyCallback: func(_ string, _ net.Addr, _ gossh.PublicKey) error { return verificationErr }}
	_, _, _, err := establishSSHConnection(t.Context(), conn, address, config)
	require.ErrorIs(t, err, verificationErr)
	records := conn.recordedDeadlines()
	require.Len(t, records, 3)
	assert.True(t, records[1].deadline.IsZero())
}

func TestEstablishHandshakeHonorsContextWhileConfirmingHostKey(t *testing.T) {
	for _, expires := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "deadline"}[expires], func(t *testing.T) {
			address, conn := dialHandshakeTestServer(t)
			ctx, cancel := handshakeConfirmationContext(t, expires)
			t.Cleanup(cancel)
			started := make(chan struct{})
			config := &gossh.ClientConfig{User: "test", HostKeyCallback: func(_ string, _ net.Addr, _ gossh.PublicKey) error {
				close(started)
				<-ctx.Done()
				return ctx.Err()
			}}
			result := make(chan error, 1)
			go func() { _, _, _, err := establishSSHConnection(ctx, conn, address, config); result <- err }()
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("host key confirmation did not start")
			}
			if !expires {
				cancel()
			}
			select {
			case err := <-result:
				require.ErrorIs(t, err, ctx.Err())
			case <-time.After(time.Second):
				t.Fatal("host key confirmation ignored context completion")
			}
		})
	}
}

func TestEstablishedConnectionRekeyDoesNotRestoreHandshakeDeadline(t *testing.T) {
	address, conn := dialHandshakeTestServer(t)
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	var verifications atomic.Int32
	config := &gossh.ClientConfig{
		Config: gossh.Config{RekeyThreshold: 1024}, User: "test",
		HostKeyCallback: func(_ string, _ net.Addr, _ gossh.PublicKey) error { verifications.Add(1); return nil },
	}
	sshConn, channels, requests, err := establishSSHConnection(ctx, conn, address, config)
	require.NoError(t, err)
	client := gossh.NewClient(sshConn, channels, requests)
	t.Cleanup(func() { _ = client.Close() })
	initialVerifications := verifications.Load()
	initialDeadlines := conn.recordedDeadlines()
	assert.True(t, initialDeadlines[len(initialDeadlines)-1].deadline.IsZero())
	cancel()
	_, _, err = client.SendRequest("rekey-test", false, make([]byte, 2048))
	require.NoError(t, err)
	_, _, err = client.SendRequest("rekey-trigger", false, nil)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return verifications.Load() > initialVerifications }, time.Second, 5*time.Millisecond)
	assert.Len(t, conn.recordedDeadlines(), len(initialDeadlines))
}

func handshakeConfirmationContext(t *testing.T, expires bool) (context.Context, context.CancelFunc) {
	t.Helper()
	if expires {
		return context.WithTimeout(t.Context(), 250*time.Millisecond)
	}
	return context.WithCancel(t.Context())
}

func dialHandshakeTestServer(t *testing.T) (string, *handshakeTestConn) {
	t.Helper()
	address, stop := testutil.NewMockServer(t)
	t.Cleanup(stop)
	conn, err := net.DialTimeout("tcp", address, time.Second)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	return address, &handshakeTestConn{Conn: conn}
}
