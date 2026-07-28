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

func TestLocalAndDynamicForwardCloseWhenSSHTransportEnds(t *testing.T) {
	tests := []struct {
		name  string
		start func(*ClientWrapper, func()) (net.Listener, error)
	}{
		{
			name: "local",
			start: func(wrapper *ClientWrapper, onExit func()) (net.Listener, error) {
				return StartLocalForward(wrapper, "127.0.0.1:0", "127.0.0.1:1", onExit)
			},
		},
		{
			name: "dynamic",
			start: func(wrapper *ClientWrapper, onExit func()) (net.Listener, error) {
				return StartDynamicForward(wrapper, "127.0.0.1:0", onExit)
			},
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			address, disconnect, stop := testutil.NewMockServerIgnoringGlobalRequests(t)
			t.Cleanup(stop)
			wrapper, err := Connect(context.Background(), model.Session{
				Host: "127.0.0.1", Port: mustParsePort(address), Username: "test", KeepAlive: 3600,
			}, nil, testutil.KnownHostsPath(t), slog.Default())
			require.NoError(t, err)
			t.Cleanup(func() { _ = wrapper.Close() })
			exited := make(chan struct{})
			listener, err := testCase.start(wrapper, func() { close(exited) })
			require.NoError(t, err)
			t.Cleanup(func() { _ = listener.Close() })
			listenAddress := listener.Addr().String()

			disconnect()

			select {
			case <-exited:
			case <-time.After(time.Second):
				t.Fatal("tunnel listener did not stop after SSH transport loss")
			}
			require.Eventually(t, func() bool {
				connection, dialErr := net.DialTimeout("tcp", listenAddress, 20*time.Millisecond)
				if dialErr == nil {
					_ = connection.Close()
				}
				return dialErr != nil
			}, time.Second, 10*time.Millisecond)
		})
	}
}
