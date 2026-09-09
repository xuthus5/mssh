package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestSessionConnectAttemptFinishesAfterSuccess(t *testing.T) {
	bus := newMockEventBus()
	service, sessionID := newConnectAttemptTestSession(t, bus)
	terminalID, err := service.connect(t.Context(), sessionID, false)
	require.NoError(t, err)
	assert.NotEmpty(t, terminalID)
	requireFinishedConnectAttempt(t, service, bus)
	assert.Equal(t, 1, service.ConnectionCount())
}

func TestSessionConnectAttemptFinishesAfterFailure(t *testing.T) {
	bus := newMockEventBus()
	service := NewSessionService(testutil.NewTestDB(t), bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	_, err := service.connect(t.Context(), 999, false)
	require.Error(t, err)
	requireFinishedConnectAttempt(t, service, bus)
	assert.Equal(t, 0, service.ConnectionCount())
}

func TestSessionConnectAttemptFinishesWhileAwaitingHostKey(t *testing.T) {
	for _, name := range []string{"rejected", "cancelled", "context cancelled"} {
		t.Run(name, func(t *testing.T) {
			bus := newManualHostKeyEventBus()
			service, sessionID := newConnectAttemptTestSession(t, bus)
			ctx, cancel := context.WithCancel(t.Context())
			t.Cleanup(cancel)
			result := make(chan error, 1)
			go func() { _, err := service.connect(ctx, sessionID, false); result <- err }()
			require.Eventually(t, func() bool { return bus.hasEvent(event.HostKeyFingerprint) }, time.Second, 5*time.Millisecond)
			prompt := bus.lastHostKeyPayload()
			require.NotNil(t, prompt)
			switch name {
			case "cancelled":
				require.NoError(t, service.CancelConnect(prompt.AttemptID))
			case "context cancelled":
				cancel()
			default:
				require.NoError(t, service.DecideHostKey(prompt.AttemptID, false))
			}
			select {
			case err := <-result:
				require.Error(t, err)
			case <-time.After(time.Second):
				t.Fatal("connection attempt did not finish")
			}
			attemptID := requireFinishedConnectAttempt(t, service, bus)
			assert.Equal(t, prompt.AttemptID, attemptID)
			assert.Error(t, service.DecideHostKey(attemptID, true))
		})
	}
}

func newConnectAttemptTestSession(t *testing.T, bus *mockEventBus) (*SessionService, int64) {
	t.Helper()
	service := NewSessionService(testutil.NewTestDB(t), bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	address, stop := sshtestutil.NewMockServer(t)
	t.Cleanup(stop)
	t.Cleanup(func() { require.NoError(t, service.CloseAll()) })
	session, err := service.CreateSession(model.SessionInputFrom(model.Session{
		Name: "attempt-lifecycle", Host: "127.0.0.1", Port: parsePort(t, address),
		Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30,
	}))
	require.NoError(t, err)
	return service, session.ID
}

func requireFinishedConnectAttempt(t *testing.T, service *SessionService, bus *mockEventBus) string {
	t.Helper()
	var attempts []event.ConnectionStatePayload
	for _, captured := range bus.Events() {
		if captured.Name != event.ConnectionAttempt {
			continue
		}
		payload, ok := captured.Payload.(event.ConnectionStatePayload)
		require.True(t, ok)
		attempts = append(attempts, payload)
	}
	require.Len(t, attempts, 2)
	assert.Equal(t, "connecting", attempts[0].State)
	assert.NotEmpty(t, attempts[0].AttemptID)
	assert.Equal(t, event.ConnectionStatePayload{AttemptID: attempts[0].AttemptID, State: "finished"}, attempts[1])
	service.mu.RLock()
	_, exists := service.attempts[attempts[0].AttemptID]
	service.mu.RUnlock()
	assert.False(t, exists)
	return attempts[0].AttemptID
}
