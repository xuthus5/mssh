package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestSessionServiceHostKeyDecisionAccept(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newManualHostKeyEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	attemptID := svc.registerConnectAttempt(1, cancel)
	defer svc.finishConnectAttempt(attemptID)

	result := make(chan bool, 1)
	go func() {
		result <- svc.awaitHostKeyDecision(ctx, attemptID, "example.com", "ssh-ed25519", "SHA256:test", false, nil)
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
	attemptID := svc.registerConnectAttempt(1, cancel)
	defer svc.finishConnectAttempt(attemptID)

	result := make(chan bool, 1)
	go func() {
		result <- svc.awaitHostKeyDecision(ctx, attemptID, "example.com", "ssh-ed25519", "SHA256:test", false, nil)
	}()

	require.NoError(t, svc.DecideHostKey(attemptID, false))
	assert.False(t, <-result)
}

func TestSessionServiceHostKeyChangeDecisionCarriesExpected(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newManualHostKeyEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	attemptID := svc.registerConnectAttempt(1, cancel)
	defer svc.finishConnectAttempt(attemptID)

	result := make(chan bool, 1)
	go func() {
		result <- svc.awaitHostKeyDecision(ctx, attemptID, "example.com", "ssh-ed25519", "SHA256:new", true, []string{"SHA256:old"})
	}()

	require.Eventually(t, func() bool { return bus.hasEvent(event.HostKeyFingerprint) }, time.Second, 10*time.Millisecond)
	payload := bus.lastHostKeyPayload()
	require.NotNil(t, payload)
	assert.True(t, payload.Changed)
	assert.Equal(t, []string{"SHA256:old"}, payload.Expected)
	require.NoError(t, svc.DecideHostKey(attemptID, true))
	assert.True(t, <-result)
}

func TestSessionServiceHostKeyChangePolicyDefaultsToBlock(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	assert.Equal(t, ssh.HostKeyPolicyBlock, svc.hostKeyChangePolicy())
}

func TestSessionServiceHostKeyChangePolicyResolvesValues(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	require.NoError(t, store.SetSettings(db, []model.Setting{{Key: hostKeyChangePolicySettingKey, Namespace: "security", Value: `"warn"`, ValueType: "string", Version: 1}}))
	assert.Equal(t, ssh.HostKeyPolicyWarn, svc.hostKeyChangePolicy())

	require.NoError(t, store.SetSettings(db, []model.Setting{{Key: hostKeyChangePolicySettingKey, Namespace: "security", Value: `"trust"`, ValueType: "string", Version: 1}}))
	assert.Equal(t, ssh.HostKeyPolicyTrust, svc.hostKeyChangePolicy())

	require.NoError(t, store.SetSettings(db, []model.Setting{{Key: hostKeyChangePolicySettingKey, Namespace: "security", Value: `"invalid"`, ValueType: "string", Version: 1}}))
	assert.Equal(t, ssh.HostKeyPolicyBlock, svc.hostKeyChangePolicy())
}

func TestSessionServiceCancelConnect(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	cancelled := make(chan struct{})
	attemptID := svc.registerConnectAttempt(1, func() { close(cancelled) })
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

func TestSessionServiceHostKeyDecisionHonorsContextCancellation(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newManualHostKeyEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	attemptID := svc.registerConnectAttempt(1, cancel)
	t.Cleanup(func() { cancel(); svc.finishConnectAttempt(attemptID) })
	result := make(chan bool, 1)
	go func() {
		result <- svc.awaitHostKeyDecision(ctx, attemptID, "one:22", "ssh-ed25519", "SHA256:one", false, nil)
	}()
	require.Eventually(t, func() bool { return hostKeyEventCount(bus) == 1 }, time.Second, 5*time.Millisecond)
	cancel()
	assert.False(t, <-result)
}

func TestSessionServiceCancelledHostKeyAttemptRejectsLaterDecision(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newManualHostKeyEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	cancelled := make(chan struct{})
	attemptID := svc.registerConnectAttempt(1, func() { close(cancelled) })

	require.NoError(t, svc.CancelConnect(attemptID))
	assert.Error(t, svc.DecideHostKey(attemptID, true))
	<-cancelled
}

func hostKeyEventCount(bus *mockEventBus) int {
	count := 0
	for _, captured := range bus.Events() {
		if captured.Name == event.HostKeyFingerprint {
			count++
		}
	}
	return count
}
