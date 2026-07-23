package ssh

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh/testutil"
)

func mustParsePort(addr string) int {
	_, portStr, _ := strings.Cut(addr, ":")
	port, _ := strconv.Atoi(portStr)
	return port
}

func TestConnect(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	defer cw.Close()
	assert.NotNil(t, cw.Inner)
}

func TestConnectInvalidHost(t *testing.T) {
	s := model.Session{Host: "invalid.zzz.invalid.zzz", Port: 22, Username: "test"}
	ctx, cancel := context.WithTimeout(context.Background(), 5*1e9)
	defer cancel()
	_, err := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	assert.Error(t, err)
}

func TestConnectHandshakeError(t *testing.T) {
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	defer l.Close()
	go func() {
		conn, _ := l.Accept()
		conn.Close()
	}()
	port := mustParsePort(l.Addr().String())
	s := model.Session{Host: "127.0.0.1", Port: port, Username: "test"}
	ctx := context.Background()
	_, err := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "ssh handshake")
}

func TestAuthMethodsBuilder(t *testing.T) {
	passAuth := gossh.Password("secret")
	assert.NotNil(t, passAuth)
}

func TestCreateHostKeyCallbackNewFile(t *testing.T) {
	knownHostsPath := t.TempDir() + "/known_hosts"
	cb, err := createHostKeyCallback(knownHostsPath, nil, slog.Default())
	require.NoError(t, err)
	assert.NotNil(t, cb)
}

func TestCreateHostKeyCallbackEmptyPath(t *testing.T) {
	cb, err := createHostKeyCallback("", nil, slog.Default())
	require.ErrorIs(t, err, ErrEmptyKnownHostsPath)
	assert.Nil(t, cb)
}

func TestConnectRejectsEmptyKnownHostsPath(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test"}
	_, err := Connect(context.Background(), s, nil, "", slog.Default())
	require.ErrorIs(t, err, ErrEmptyKnownHostsPath)
}

func TestClientWrapperClose(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	err = cw.Close()
	assert.NoError(t, err)
}

func TestClientWrapperCloseIsConcurrentAndIdempotent(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	cw, err := Connect(context.Background(), model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test"}, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	var waitGroup sync.WaitGroup
	errors := make(chan error, 16)
	for range 16 {
		waitGroup.Add(1)
		go func() { defer waitGroup.Done(); errors <- cw.Close() }()
	}
	waitGroup.Wait()
	close(errors)
	for closeErr := range errors {
		assert.NoError(t, closeErr)
	}
}

func TestConnectWithKnownHosts(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	knownHostsPath := t.TempDir() + "/known_hosts"
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", KeepAlive: 30}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, knownHostsPath, slog.Default())
	require.NoError(t, err)
	defer cw.Close()
	assert.NotNil(t, cw.Inner)

	_, err = os.Stat(knownHostsPath)
	assert.NoError(t, err)
}

func TestConnectKeepsAliveStarted(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", KeepAlive: 1}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	assert.NotNil(t, cw.Inner)
	time.Sleep(2 * time.Second)
	cw.Close()
}

func mustParsePortNet(addr net.Addr) int {
	_, portStr, _ := strings.Cut(addr.String(), ":")
	port, _ := strconv.Atoi(portStr)
	return port
}

func TestCreateHostKeyCallbackWithVerifier(t *testing.T) {
	knownHostsPath := t.TempDir() + "/known_hosts"
	called := false
	verifier := func(hostname, algorithm, fingerprint string) bool {
		called = true
		assert.NotEmpty(t, hostname)
		assert.NotEmpty(t, algorithm)
		assert.NotEmpty(t, fingerprint)
		return true
	}
	cb, err := createHostKeyCallback(knownHostsPath, verifier, slog.Default())
	require.NoError(t, err)
	assert.NotNil(t, cb)
	_ = called
}

func TestCreateHostKeyCallbackVerifierRejects(t *testing.T) {
	knownHostsPath := t.TempDir() + "/known_hosts"
	verifier := func(_, _, _ string) bool {
		return false
	}
	cb, err := createHostKeyCallback(knownHostsPath, verifier, slog.Default())
	require.NoError(t, err)
	assert.NotNil(t, cb)

}

func TestConnectWithVerifierAccepts(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	knownHostsPath := t.TempDir() + "/known_hosts"
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", KeepAlive: 30}
	verifier := func(_, _, _ string) bool { return true }
	ctx := context.Background()
	cw, err := ConnectWithVerifier(ctx, s, nil, knownHostsPath, verifier, slog.Default())
	require.NoError(t, err)
	defer cw.Close()
	assert.NotNil(t, cw.Inner)
}

func TestConnectWithVerifierRejects(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	knownHostsPath := t.TempDir() + "/known_hosts"
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", KeepAlive: 30}
	verifier := func(_, _, _ string) bool { return false }
	ctx := context.Background()
	_, err := ConnectWithVerifier(ctx, s, nil, knownHostsPath, verifier, slog.Default())
	assert.Error(t, err)
}

func TestRemoteFileSize(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, sftpClient := connectSFTP(t, addr)
	defer cw.Close()
	defer sftpClient.Close()

	f, err := sftpClient.Create("/size_test.txt")
	require.NoError(t, err)
	_ = f.Close()

	size, err := RemoteFileSize(sftpClient, "/size_test.txt")
	require.NoError(t, err)
	assert.Equal(t, int64(0), size)
}

func TestRemoteFileSizeNotFound(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, sftpClient := connectSFTP(t, addr)
	defer cw.Close()
	defer sftpClient.Close()

	_, err := RemoteFileSize(sftpClient, "/nonexistent_file")
	assert.Error(t, err)
}

func TestHostKeyChangedErrorIncludesFingerprints(t *testing.T) {
	pubA, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	pubB, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	keyA, err := gossh.NewPublicKey(pubA)
	require.NoError(t, err)
	keyB, err := gossh.NewPublicKey(pubB)
	require.NoError(t, err)

	err = hostKeyChangedError("example.com", keyB, &knownhosts.KeyError{
		Want: []knownhosts.KnownKey{{Key: keyA}},
	})
	require.Error(t, err)
	msg := err.Error()
	assert.Contains(t, msg, "example.com")
	assert.Contains(t, msg, "changed")
	assert.Contains(t, msg, gossh.FingerprintSHA256(keyA))
	assert.Contains(t, msg, gossh.FingerprintSHA256(keyB))
	assert.Contains(t, msg, "Security settings")
}

func TestVerifyHostKeyBlocksChangedKey(t *testing.T) {
	dir := t.TempDir()
	knownHostsPath := filepath.Join(dir, "known_hosts")
	pubA, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	pubB, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	keyA, err := gossh.NewPublicKey(pubA)
	require.NoError(t, err)
	keyB, err := gossh.NewPublicKey(pubB)
	require.NoError(t, err)
	require.NoError(t, appendKnownHost(knownHostsPath, "example.com", keyA))

	cb, err := createHostKeyCallback(knownHostsPath, nil, slog.Default())
	require.NoError(t, err)
	err = cb("example.com:22", &net.TCPAddr{IP: net.IPv4(1, 2, 3, 4), Port: 22}, keyB)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "changed")
	assert.Contains(t, err.Error(), gossh.FingerprintSHA256(keyA))
	assert.Contains(t, err.Error(), gossh.FingerprintSHA256(keyB))
}

func TestAppendKnownHostConcurrent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	pubA, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	pubB, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	keyA, err := gossh.NewPublicKey(pubA)
	require.NoError(t, err)
	keyB, err := gossh.NewPublicKey(pubB)
	require.NoError(t, err)

	var waitGroup sync.WaitGroup
	waitGroup.Add(2)
	go func() {
		defer waitGroup.Done()
		require.NoError(t, appendKnownHost(path, "a.example.com", keyA))
	}()
	go func() {
		defer waitGroup.Done()
		require.NoError(t, appendKnownHost(path, "b.example.com", keyB))
	}()
	waitGroup.Wait()

	content, err := os.ReadFile(path)
	require.NoError(t, err)
	lines := strings.Split(strings.TrimSpace(string(content)), "\n")
	require.Len(t, lines, 2)
	assert.Contains(t, string(content), "a.example.com")
	assert.Contains(t, string(content), "b.example.com")
}

func TestWithKnownHostsLockSerializes(t *testing.T) {
	var order []int
	var waitGroup sync.WaitGroup
	waitGroup.Add(2)
	go func() {
		defer waitGroup.Done()
		require.NoError(t, WithKnownHostsLock(func() error {
			order = append(order, 1)
			time.Sleep(20 * time.Millisecond)
			order = append(order, 2)
			return nil
		}))
	}()
	go func() {
		defer waitGroup.Done()
		time.Sleep(5 * time.Millisecond)
		require.NoError(t, WithKnownHostsLock(func() error {
			order = append(order, 3)
			return nil
		}))
	}()
	waitGroup.Wait()
	// Second critical section must not interleave between 1 and 2.
	assert.Equal(t, []int{1, 2, 3}, order)
}
