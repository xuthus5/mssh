package ssh

import (
	"context"
	"log/slog"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh/testutil"
)

func TestConnectHandshakeStopsWhenContextExpires(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })

	accepted := make(chan net.Conn, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr == nil {
			accepted <- connection
		}
	}()

	ctx, cancel := context.WithTimeout(t.Context(), 40*time.Millisecond)
	defer cancel()
	result := make(chan error, 1)
	port := listener.Addr().(*net.TCPAddr).Port
	go func() {
		_, connectErr := Connect(ctx, model.Session{
			Host: "127.0.0.1", Port: port, Username: "test",
		}, nil, testutil.KnownHostsPath(t), slog.Default())
		result <- connectErr
	}()

	serverConnection := <-accepted
	t.Cleanup(func() { _ = serverConnection.Close() })
	select {
	case connectErr := <-result:
		require.ErrorIs(t, connectErr, context.DeadlineExceeded)
	case <-time.After(250 * time.Millisecond):
		_ = serverConnection.Close()
		<-result
		t.Fatal("SSH handshake did not stop after context expiration")
	}
}
