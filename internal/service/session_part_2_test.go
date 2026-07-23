package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestSessionServiceHostKeyDecisionAccept(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newManualHostKeyEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	attemptID := svc.registerConnectAttempt(cancel)
	defer svc.finishConnectAttempt(attemptID)

	result := make(chan bool, 1)
	go func() {
		result <- svc.awaitHostKeyDecision(ctx, attemptID, "example.com", "ssh-ed25519", "SHA256:test")
	}()

	require.Eventually(t, func() bool {
		return bus.hasEvent(event.HostKeyFingerprint)
	}, time.Second, 10*time.Millisecond)
	require.NoError(t, svc.DecideHostKey(attemptID, true))
	assert.True(t, <-result)
}

func TestSessionServiceHostKeyDecisionReject(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newManualHostKeyEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	attemptID := svc.registerConnectAttempt(cancel)
	defer svc.finishConnectAttempt(attemptID)

	result := make(chan bool, 1)
	go func() {
		result <- svc.awaitHostKeyDecision(ctx, attemptID, "example.com", "ssh-ed25519", "SHA256:test")
	}()

	require.NoError(t, svc.DecideHostKey(attemptID, false))
	assert.False(t, <-result)
}

func TestSessionServiceCancelConnect(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	cancelled := make(chan struct{})
	attemptID := svc.registerConnectAttempt(func() { close(cancelled) })
	require.NoError(t, svc.CancelConnect(attemptID))
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("connection attempt was not cancelled")
	}
	assert.Error(t, svc.CancelConnect(attemptID))
}

func TestSessionServiceHostKeyDecisionUnknownAttempt(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	assert.Error(t, svc.DecideHostKey("missing", true))
	assert.Error(t, svc.CancelConnect("missing"))
}

func TestSessionServiceRejectsEmptyAttemptID(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	assert.Error(t, svc.DecideHostKey("", true))
	assert.Error(t, svc.DecideHostKey("   ", false))
	assert.Error(t, svc.CancelConnect(""))
}
