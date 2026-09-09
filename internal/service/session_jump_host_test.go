package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestSSHJumpHostTestDoesNotSaveSessionOrOpenTerminal(t *testing.T) {
	bus := newMockEventBus()
	service := NewSessionService(testutil.NewTestDB(t), bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	address, stop := sshtestutil.NewMockServer(t)
	t.Cleanup(stop)
	input := model.SSHJumpHostTestInput{RequestID: "test-jump-1", JumpHost: model.SSHJumpHost{
		Host: "127.0.0.1", Port: parsePort(t, address), Username: "root", AuthMethod: model.AuthPassword,
	}}

	require.NoError(t, service.TestSSHJumpHost(t.Context(), input))
	assert.Zero(t, service.ConnectionCount())
	sessions, err := store.ListSessions(service.db, nil)
	require.NoError(t, err)
	assert.Empty(t, sessions)
	var prompt event.HostKeyPayload
	for _, captured := range bus.Events() {
		if captured.Name == event.HostKeyFingerprint {
			prompt = captured.Payload.(event.HostKeyPayload)
		}
	}
	assert.Equal(t, input.RequestID, prompt.RequestID)
	assert.True(t, prompt.IsJumpHost)
	assert.True(t, prompt.UsesJumpHost)
	assert.NotEmpty(t, prompt.AttemptID)
	assert.Empty(t, service.attempts)
}

func TestSSHJumpHostTestHonorsCancellation(t *testing.T) {
	service := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	err := service.TestSSHJumpHost(ctx, model.SSHJumpHostTestInput{
		RequestID: "cancelled-jump", JumpHost: model.SSHJumpHost{Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword},
	})
	require.ErrorIs(t, err, context.Canceled)
	assert.Zero(t, service.ConnectionCount())
	assert.Empty(t, service.attempts)
}

func TestSSHJumpHostTestValidatesInputAndShutdown(t *testing.T) {
	service := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	input := model.SSHJumpHostTestInput{RequestID: "test-1", JumpHost: model.SSHJumpHost{Host: "host", Port: 22, Username: "root", AuthMethod: model.AuthPassword}}
	for _, requestID := range []string{"", "bad request", string(make([]byte, 129))} {
		invalid := input
		invalid.RequestID = requestID
		require.ErrorContains(t, service.TestSSHJumpHost(t.Context(), invalid), "request id")
	}
	input.JumpHost.Port = 0
	require.Error(t, service.TestSSHJumpHost(t.Context(), input))
	require.NoError(t, service.Shutdown())
	require.ErrorContains(t, service.TestSSHJumpHost(t.Context(), input), "shutting down")
}
