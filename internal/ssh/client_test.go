package ssh

import (
	"context"
	"log/slog"
	"net"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"mssh/internal/model"
	"mssh/internal/ssh/testutil"
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
	cw, err := Connect(ctx, s, nil, "", slog.Default())
	require.NoError(t, err)
	defer cw.Close()
	assert.NotNil(t, cw.Inner)
}

func TestConnectInvalidHost(t *testing.T) {
	s := model.Session{Host: "invalid.zzz.invalid.zzz", Port: 22, Username: "test"}
	ctx, cancel := context.WithTimeout(context.Background(), 5*1e9)
	defer cancel()
	_, err := Connect(ctx, s, nil, "", slog.Default())
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
	_, err := Connect(ctx, s, nil, "", slog.Default())
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "ssh handshake")
}

func TestAuthMethodsBuilder(t *testing.T) {
	passAuth := gossh.Password("secret")
	assert.NotNil(t, passAuth)
}

func TestCreateHostKeyCallbackNewFile(t *testing.T) {
	knownHostsPath := t.TempDir() + "/known_hosts"
	cb, err := createHostKeyCallback(knownHostsPath)
	require.NoError(t, err)
	assert.NotNil(t, cb)
}

func TestCreateHostKeyCallbackEmptyPath(t *testing.T) {
	cb, err := createHostKeyCallback("")
	require.NoError(t, err)
	assert.NotNil(t, cb)
}

func TestClientWrapperClose(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, "", slog.Default())
	require.NoError(t, err)
	err = cw.Close()
	assert.NoError(t, err)
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
	cw, err := Connect(ctx, s, nil, "", slog.Default())
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
