package ssh

import (
	"context"
	"net"
	"strconv"
	"strings"
	"testing"

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
	cw, err := Connect(ctx, s, nil)
	require.NoError(t, err)
	defer cw.Close()
	assert.NotNil(t, cw.Inner)
}

func TestConnectInvalidHost(t *testing.T) {
	s := model.Session{Host: "invalid.zzz.invalid.zzz", Port: 22, Username: "test"}
	ctx, cancel := context.WithTimeout(context.Background(), 5*1e9)
	defer cancel()
	_, err := Connect(ctx, s, nil)
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
	_, err := Connect(ctx, s, nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "ssh handshake")
}

func TestAuthMethodsBuilder(t *testing.T) {
	passAuth := gossh.Password("secret")
	assert.NotNil(t, passAuth)
}
