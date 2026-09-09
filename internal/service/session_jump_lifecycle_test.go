package service

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSSHJumpTerminalRejectAndCancelEachFingerprintStage(t *testing.T) {
	for _, stage := range []string{"jump", "target"} {
		for _, action := range []string{"reject", "cancel"} {
			t.Run(stage+"-"+action, func(t *testing.T) { exerciseJumpStageFailure(t, stage, action) })
		}
	}
}

func exerciseJumpStageFailure(t *testing.T, stage, action string) {
	t.Helper()
	fixture := newJumpServiceFixture(t, newManualHostKeyEventBus(), "")
	results := startJumpTerminal(t, fixture, "jump-stage-failure")
	prompt := waitJumpServiceFingerprint(t, fixture.bus, 0)
	wantedPrompts := 1
	if stage == "target" {
		require.NoError(t, fixture.sessions.DecideHostKey(prompt.AttemptID, true))
		prompt = waitJumpServiceFingerprint(t, fixture.bus, 1)
		wantedPrompts = 2
	}
	assert.Equal(t, stage == "jump", prompt.IsJumpHost)
	assert.Zero(t, fixture.sessions.ConnectionCount())
	if action == "cancel" {
		require.NoError(t, fixture.sessions.CancelConnect(prompt.AttemptID))
	} else {
		require.NoError(t, fixture.sessions.DecideHostKey(prompt.AttemptID, false))
	}
	result := waitJumpTerminal(t, results)
	require.Error(t, result.err)
	if action == "cancel" {
		assert.ErrorIs(t, result.err, context.Canceled)
	} else {
		assert.ErrorContains(t, result.err, "host key rejected")
	}
	assert.Empty(t, result.terminalID)
	assert.Len(t, jumpServiceFingerprints(fixture.bus), wantedPrompts)
	assert.Len(t, jumpServiceProgress(fixture.bus), wantedPrompts)
	assert.Empty(t, jumpConnectedTerminals(fixture.bus))
	assert.Error(t, fixture.sessions.DecideHostKey(prompt.AttemptID, true))
	assertNoJumpServiceResources(t, fixture)
	stored, err := store.GetSession(fixture.sessions.db, fixture.session.ID)
	require.NoError(t, err)
	assert.Zero(t, stored.ConnectionCount)
	assert.Nil(t, stored.LastConnectedAt)
}

func TestSSHJumpTerminalTargetAuthPreparationFailureCleansUp(t *testing.T) {
	t.Setenv("SSH_AUTH_SOCK", filepath.Join(t.TempDir(), "missing-agent.sock"))
	fixture := newJumpServiceFixture(t, newManualHostKeyEventBus(), "")
	input := model.SessionInputFrom(*fixture.session)
	input.AuthMethod = model.AuthAgent
	require.NoError(t, fixture.sessions.UpdateSession(input))
	results := startJumpTerminal(t, fixture, "target-auth-failure")
	prompt := waitJumpServiceFingerprint(t, fixture.bus, 0)
	require.NoError(t, fixture.sessions.DecideHostKey(prompt.AttemptID, true))
	result := waitJumpTerminal(t, results)
	require.ErrorContains(t, result.err, "target authentication")
	assert.Empty(t, result.terminalID)
	assert.Len(t, jumpServiceFingerprints(fixture.bus), 1)
	assertNoJumpServiceResources(t, fixture)
}

func TestSSHJumpTerminalRejectedPTYCleansUpRegisteredConnection(t *testing.T) {
	address, stop := sshtestutil.NewMockServerRejectPty(t)
	t.Cleanup(stop)
	fixture := newJumpServiceFixture(t, newManualHostKeyEventBus(), address)
	results := startJumpTerminal(t, fixture, "jump-rejected-pty")
	for index := range 2 {
		prompt := waitJumpServiceFingerprint(t, fixture.bus, index)
		require.NoError(t, fixture.sessions.DecideHostKey(prompt.AttemptID, true))
	}
	result := waitJumpTerminal(t, results)
	require.ErrorContains(t, result.err, "request pty")
	assert.Empty(t, result.terminalID)
	assertNoJumpServiceResources(t, fixture)
	assert.Empty(t, jumpConnectedTerminals(fixture.bus))
}

func trustOnlyJumpHost(t *testing.T, fixture *jumpServiceFixture) {
	t.Helper()
	result := make(chan error, 1)
	go func() {
		result <- fixture.sessions.TestSSHJumpHost(t.Context(), model.SSHJumpHostTestInput{
			SessionID: fixture.session.ID, RequestID: "trust-background-jump", JumpHost: *fixture.session.JumpHost,
		})
	}()
	prompt := waitJumpServiceFingerprint(t, fixture.bus, 0)
	require.NoError(t, fixture.sessions.DecideHostKey(prompt.AttemptID, true))
	require.NoError(t, waitJumpServiceError(t, result))
}

func waitJumpServiceError(t *testing.T, results <-chan error) error {
	t.Helper()
	select {
	case err := <-results:
		return err
	case <-time.After(jumpServiceWait):
		t.Fatal("SSH jump service operation did not finish")
		return nil
	}
}

func TestSSHJumpAIAgentRejectsUnknownEndpointsDespiteTrustSetting(t *testing.T) {
	for _, stage := range []string{"jump", "target"} {
		t.Run(stage, func(t *testing.T) {
			fixture := newJumpServiceFixture(t, newManualHostKeyEventBus(), "")
			if stage == "target" {
				trustOnlyJumpHost(t, fixture)
			}
			promptsBefore := len(jumpServiceFingerprints(fixture.bus))
			require.NoError(t, store.SetSettings(fixture.sessions.db, []model.Setting{
				{Key: hostKeyChangePolicySettingKey, Namespace: "security", Value: `"trust"`, ValueType: "string", Version: 1},
			}))
			ctx, cancel := context.WithTimeout(t.Context(), jumpServiceWait)
			t.Cleanup(cancel)
			client, cleanup, err := fixture.sessions.openAIAgentConnection(ctx, fixture.session.ID)
			require.ErrorContains(t, err, "host key rejected")
			if stage == "target" {
				assert.ErrorContains(t, err, "jump-only.internal:22")
			}
			assert.Nil(t, client)
			assert.Nil(t, cleanup)
			assert.Len(t, jumpServiceFingerprints(fixture.bus), promptsBefore)
			assertNoJumpServiceResources(t, fixture)
		})
	}
}

func TestSSHJumpAIAgentAndProbeUseIndependentKnownConnections(t *testing.T) {
	fixture := newJumpServiceFixture(t, newManualHostKeyEventBus(), "")
	terminalID := trustJumpTerminal(t, fixture)
	ai, cleanup, err := fixture.sessions.openAIAgentConnection(t.Context(), fixture.session.ID)
	require.NoError(t, err)
	t.Cleanup(func() { _ = closeRejectedConnection(ai, cleanup) })
	assert.Equal(t, 1, fixture.sessions.ConnectionCount())
	_, _, err = ai.Inner.SendRequest("ai-connection", true, nil)
	require.NoError(t, err)
	probe, release, err := fixture.terminals.acquireSystemProbeConnection(fixture.session.ID)
	require.NoError(t, err)
	t.Cleanup(release)
	assert.NotSame(t, ai, probe)
	assert.Equal(t, 2, fixture.sessions.ConnectionCount())
	_, _, err = probe.Inner.SendRequest("probe-connection", true, nil)
	require.NoError(t, err)
	assert.Len(t, jumpServiceFingerprints(fixture.bus), 2)
	require.NoError(t, closeRejectedConnection(ai, cleanup))
	release()
	assert.Equal(t, 2, fixture.sessions.ConnectionCount())
	assertJumpTerminalOutput(t, fixture, terminalID)
	require.NoError(t, fixture.terminals.Close(terminalID))
	assertNoJumpServiceResources(t, fixture)
	select {
	case <-probe.Done():
	default:
		t.Fatal("probe jump connection remained open after closing its last terminal")
	}
}

func TestSSHJumpProbeWaitsForUnknownHostDecision(t *testing.T) {
	for _, stage := range []string{"jump", "target"} {
		t.Run(stage, func(t *testing.T) {
			fixture := newJumpServiceFixture(t, newManualHostKeyEventBus(), "")
			if stage == "target" {
				trustOnlyJumpHost(t, fixture)
			}
			promptsBefore := len(jumpServiceFingerprints(fixture.bus))
			result := make(chan error, 1)
			go func() {
				_, disconnect, err := openSystemProbeConnection(fixture.sessions, fixture.session.ID)
				if disconnect != nil {
					disconnect()
				}
				result <- err
			}()
			prompt := waitJumpServiceFingerprint(t, fixture.bus, promptsBefore)
			assert.Equal(t, stage == "jump", prompt.IsJumpHost)
			assert.Empty(t, prompt.RequestID)
			assert.Zero(t, fixture.sessions.ConnectionCount())
			require.NoError(t, fixture.sessions.DecideHostKey(prompt.AttemptID, false))
			require.ErrorContains(t, waitJumpServiceError(t, result), "host key rejected")
			assert.Len(t, jumpServiceFingerprints(fixture.bus), promptsBefore+1)
			assertNoJumpServiceResources(t, fixture)
		})
	}
}

func TestSSHJumpAgentAuthCleanupOnCloseAndFingerprintFailure(t *testing.T) {
	_, stop := startTestSSHAgent(t)
	t.Cleanup(stop)
	for _, outcome := range []string{"success", "reject-jump", "reject-target"} {
		t.Run(outcome, func(t *testing.T) { exerciseJumpAgentCleanup(t, outcome) })
	}
}

func exerciseJumpAgentCleanup(t *testing.T, outcome string) {
	t.Helper()
	fixture := newJumpServiceFixture(t, newManualHostKeyEventBus(), "")
	input := model.SessionInputFrom(*fixture.session)
	input.AuthMethod, input.JumpHost.AuthMethod = model.AuthAgent, model.AuthAgent
	require.NoError(t, fixture.sessions.UpdateSession(input))
	results := startJumpTerminal(t, fixture, "jump-agent-cleanup")
	prompt := waitJumpServiceFingerprint(t, fixture.bus, 0)
	if outcome != "reject-jump" {
		require.NoError(t, fixture.sessions.DecideHostKey(prompt.AttemptID, true))
		prompt = waitJumpServiceFingerprint(t, fixture.bus, 1)
	}
	require.NoError(t, fixture.sessions.DecideHostKey(prompt.AttemptID, outcome == "success"))
	result := waitJumpTerminal(t, results)
	if outcome == "success" {
		require.NoError(t, result.err)
		assertJumpTerminalOutput(t, fixture, result.terminalID)
		require.NoError(t, fixture.terminals.Close(result.terminalID))
	} else {
		require.ErrorContains(t, result.err, "host key rejected")
		assert.Empty(t, result.terminalID)
	}
	assertNoJumpServiceResources(t, fixture)
}
