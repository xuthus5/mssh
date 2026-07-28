package ssh

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh/testutil"
)

func TestKeepAliveRequestTimeoutClosesConnection(t *testing.T) {
	address, _, stop := testutil.NewMockServerIgnoringGlobalRequests(t)
	t.Cleanup(stop)
	wrapper, err := Connect(context.Background(), model.Session{
		Host: "127.0.0.1", Port: mustParsePort(address), Username: "test", KeepAlive: 3600,
	}, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	t.Cleanup(func() { _ = wrapper.Close() })

	started := time.Now()
	err = wrapper.sendKeepAliveRequest(20 * time.Millisecond)

	require.Error(t, err)
	assert.True(t, errors.Is(err, errKeepAliveTimedOut))
	assert.Less(t, time.Since(started), time.Second)
	select {
	case <-wrapper.Done():
	case <-time.After(time.Second):
		t.Fatal("SSH connection did not report closure after keep-alive timeout")
	}
}

func TestClientWrapperDoneClosesOnTransportLoss(t *testing.T) {
	address, disconnect, stop := testutil.NewMockServerIgnoringGlobalRequests(t)
	t.Cleanup(stop)
	wrapper, err := Connect(context.Background(), model.Session{
		Host: "127.0.0.1", Port: mustParsePort(address), Username: "test", KeepAlive: 3600,
	}, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	t.Cleanup(func() { _ = wrapper.Close() })

	disconnect()

	select {
	case <-wrapper.Done():
	case <-time.After(time.Second):
		t.Fatal("SSH connection did not report transport loss")
	}
}
