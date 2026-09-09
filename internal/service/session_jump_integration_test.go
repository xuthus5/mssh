package service

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

const jumpServiceWait = 2 * time.Second

type jumpServiceFixture struct {
	sessions      *SessionService
	terminals     *TerminalService
	bus           *mockEventBus
	session       *model.Session
	targetAddress string
}

type jumpTerminalResult struct {
	terminalID string
	err        error
}

func newJumpServiceFixture(t *testing.T, bus *mockEventBus, targetAddress string) *jumpServiceFixture {
	t.Helper()
	if targetAddress == "" {
		var stop func()
		targetAddress, stop = sshtestutil.NewMockServer(t)
		t.Cleanup(stop)
	}
	jumpAddress, _ := sshtestutil.NewJumpServer(t, targetAddress)
	sessions := NewSessionService(testutil.NewTestDB(t), bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	t.Cleanup(func() { require.NoError(t, sessions.Shutdown()) })
	created, err := sessions.CreateSession(model.SessionInput{
		Name: "jump-integration", Host: "jump-only.internal", Port: 22, Username: "target", AuthMethod: model.AuthPassword,
		JumpHost: &model.SSHJumpHost{Host: "127.0.0.1", Port: parsePort(t, jumpAddress), Username: "jump", AuthMethod: model.AuthPassword},
	})
	require.NoError(t, err)
	terminals := NewTerminalService(sessions, bus, 4, testutil.NewTestLogger())
	t.Cleanup(func() { require.NoError(t, terminals.Shutdown()) })
	return &jumpServiceFixture{sessions: sessions, terminals: terminals, bus: bus, session: created, targetAddress: targetAddress}
}

func startJumpTerminal(t *testing.T, fixture *jumpServiceFixture, requestID string) <-chan jumpTerminalResult {
	t.Helper()
	result := make(chan jumpTerminalResult, 1)
	go func() {
		terminalID, err := fixture.terminals.OpenWithProgress(t.Context(), model.SSHOpenRequest{
			SessionID: fixture.session.ID, Cols: 80, Rows: 24, RequestID: requestID,
		})
		result <- jumpTerminalResult{terminalID: terminalID, err: err}
	}()
	return result
}

func waitJumpTerminal(t *testing.T, results <-chan jumpTerminalResult) jumpTerminalResult {
	t.Helper()
	select {
	case result := <-results:
		return result
	case <-time.After(jumpServiceWait):
		t.Fatal("SSH terminal operation did not finish")
		return jumpTerminalResult{}
	}
}

func jumpServiceFingerprints(bus *mockEventBus) []event.HostKeyPayload {
	var prompts []event.HostKeyPayload
	for _, captured := range bus.Events() {
		if prompt, ok := captured.Payload.(event.HostKeyPayload); captured.Name == event.HostKeyFingerprint && ok {
			prompts = append(prompts, prompt)
		}
	}
	return prompts
}

func waitJumpServiceFingerprint(t *testing.T, bus *mockEventBus, index int) event.HostKeyPayload {
	t.Helper()
	require.Eventually(t, func() bool { return len(jumpServiceFingerprints(bus)) > index }, jumpServiceWait, time.Millisecond)
	return jumpServiceFingerprints(bus)[index]
}

func jumpServiceProgress(bus *mockEventBus) []event.ConnectionProgressPayload {
	var progress []event.ConnectionProgressPayload
	for _, captured := range bus.Events() {
		if payload, ok := captured.Payload.(event.ConnectionProgressPayload); captured.Name == event.ConnectionProgress && ok {
			progress = append(progress, payload)
		}
	}
	return progress
}

func jumpConnectedTerminals(bus *mockEventBus) []string {
	var terminalIDs []string
	for _, captured := range bus.Events() {
		if payload, ok := captured.Payload.(event.ConnectionStatePayload); captured.Name == event.ConnectionState && ok && payload.State == "connected" {
			terminalIDs = append(terminalIDs, payload.TerminalID)
		}
	}
	return terminalIDs
}

func assertNoJumpServiceResources(t *testing.T, fixture *jumpServiceFixture) {
	t.Helper()
	assert.Zero(t, fixture.sessions.ConnectionCount())
	assert.Zero(t, fixture.terminals.Count())
	fixture.sessions.mu.RLock()
	activeAttempts := len(fixture.sessions.attempts)
	fixture.sessions.mu.RUnlock()
	assert.Zero(t, activeAttempts)
}

func trustJumpTerminal(t *testing.T, fixture *jumpServiceFixture) string {
	t.Helper()
	results := startJumpTerminal(t, fixture, "trusted-jump-terminal")
	for index := range 2 {
		prompt := waitJumpServiceFingerprint(t, fixture.bus, index)
		require.NoError(t, fixture.sessions.DecideHostKey(prompt.AttemptID, true))
	}
	result := waitJumpTerminal(t, results)
	require.NoError(t, result.err)
	return result.terminalID
}

func assertJumpTerminalOutput(t *testing.T, fixture *jumpServiceFixture, terminalID string) {
	t.Helper()
	require.NoError(t, fixture.terminals.Attach(terminalID))
	require.Eventually(t, func() bool {
		var output strings.Builder
		for _, captured := range fixture.bus.Events() {
			if payload, ok := captured.Payload.(event.TerminalOutputPayload); captured.Name == event.TerminalOutput && ok && payload.TerminalID == terminalID {
				_, _ = output.Write(payload.Data)
			}
		}
		return strings.Contains(output.String(), "mock> ")
	}, jumpServiceWait, time.Millisecond)
}

func TestSSHJumpTerminalProgressKeepsBothFingerprintsInOneRequest(t *testing.T) {
	fixture := newJumpServiceFixture(t, newManualHostKeyEventBus(), "")
	const requestID = "jump-terminal-integration"
	results := startJumpTerminal(t, fixture, requestID)
	jump := waitJumpServiceFingerprint(t, fixture.bus, 0)
	assert.True(t, jump.IsJumpHost)
	assert.True(t, jump.UsesJumpHost)
	assert.Equal(t, requestID, jump.RequestID)
	assert.Contains(t, jump.Hostname, "127.0.0.1:")
	assert.Equal(t, []event.ConnectionProgressPayload{{RequestID: requestID, AttemptID: jump.AttemptID, Stage: "jump"}}, jumpServiceProgress(fixture.bus))
	assert.Zero(t, fixture.sessions.ConnectionCount())
	require.NoError(t, fixture.sessions.DecideHostKey(jump.AttemptID, true))
	target := waitJumpServiceFingerprint(t, fixture.bus, 1)
	assert.False(t, target.IsJumpHost)
	assert.True(t, target.UsesJumpHost)
	assert.Equal(t, requestID, target.RequestID)
	assert.Equal(t, "jump-only.internal:22", target.Hostname)
	assert.NotEqual(t, jump.AttemptID, target.AttemptID)
	assert.NotEqual(t, jump.Fingerprint, target.Fingerprint)
	assert.Equal(t, []event.ConnectionProgressPayload{
		{RequestID: requestID, AttemptID: jump.AttemptID, Stage: "jump"},
		{RequestID: requestID, AttemptID: target.AttemptID, Stage: "target"},
	}, jumpServiceProgress(fixture.bus))
	require.NoError(t, fixture.sessions.DecideHostKey(target.AttemptID, true))
	result := waitJumpTerminal(t, results)
	require.NoError(t, result.err)
	assert.NotEmpty(t, result.terminalID)
	assert.Equal(t, 1, fixture.terminals.Count())
	assert.Equal(t, 1, fixture.sessions.ConnectionCount())
	assert.Equal(t, []string{result.terminalID}, jumpConnectedTerminals(fixture.bus))
	assertJumpTerminalOutput(t, fixture, result.terminalID)
	require.NoError(t, fixture.terminals.Close(result.terminalID))
	assertNoJumpServiceResources(t, fixture)
}

func TestSSHJumpDisabledKeepsDirectConnectionProgress(t *testing.T) {
	fixture := newJumpServiceFixture(t, newManualHostKeyEventBus(), "")
	input := model.SessionInputFrom(*fixture.session)
	input.JumpHost = nil
	input.Host, input.Port = "127.0.0.1", parsePort(t, fixture.targetAddress)
	require.NoError(t, fixture.sessions.UpdateSession(input))
	const requestID = "direct-terminal-integration"
	results := startJumpTerminal(t, fixture, requestID)
	target := waitJumpServiceFingerprint(t, fixture.bus, 0)
	assert.False(t, target.IsJumpHost)
	assert.Equal(t, requestID, target.RequestID)
	assert.Equal(t, []event.ConnectionProgressPayload{{RequestID: requestID, AttemptID: target.AttemptID, Stage: "target"}}, jumpServiceProgress(fixture.bus))
	assert.False(t, target.UsesJumpHost)
	require.NoError(t, fixture.sessions.DecideHostKey(target.AttemptID, true))
	result := waitJumpTerminal(t, results)
	require.NoError(t, result.err)
	assert.Len(t, jumpServiceFingerprints(fixture.bus), 1)
	assertJumpTerminalOutput(t, fixture, result.terminalID)
	require.NoError(t, fixture.terminals.Close(result.terminalID))
	assertNoJumpServiceResources(t, fixture)
}

func TestSSHJumpChangedFingerprintKeepsEndpointAndExpectedKey(t *testing.T) {
	for _, stage := range []string{"jump", "target"} {
		t.Run(stage, func(t *testing.T) { exerciseJumpChangedFingerprint(t, stage) })
	}
}

func exerciseJumpChangedFingerprint(t *testing.T, stage string) {
	t.Helper()
	fixture := newJumpServiceFixture(t, newManualHostKeyEventBus(), "")
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	previousKey, err := gossh.NewPublicKey(publicKey)
	require.NoError(t, err)
	hostname := "jump-only.internal:22"
	if stage == "jump" {
		hostname = fmt.Sprintf("%s:%d", fixture.session.JumpHost.Host, fixture.session.JumpHost.Port)
	}
	line := knownhosts.Line([]string{hostname}, previousKey) + "\n"
	require.NoError(t, os.WriteFile(filepath.Join(fixture.sessions.dataDir, "known_hosts"), []byte(line), 0o600))
	require.NoError(t, store.SetSettings(fixture.sessions.db, []model.Setting{
		{Key: hostKeyChangePolicySettingKey, Namespace: "security", Value: `"warn"`, ValueType: "string", Version: 1},
	}))
	results := startJumpTerminal(t, fixture, "changed-jump-fingerprint")
	prompt := waitJumpServiceFingerprint(t, fixture.bus, 0)
	if stage == "target" {
		require.NoError(t, fixture.sessions.DecideHostKey(prompt.AttemptID, true))
		prompt = waitJumpServiceFingerprint(t, fixture.bus, 1)
	}
	assert.True(t, prompt.Changed)
	assert.Equal(t, stage == "jump", prompt.IsJumpHost)
	assert.Equal(t, hostname, prompt.Hostname)
	assert.Equal(t, "changed-jump-fingerprint", prompt.RequestID)
	assert.Equal(t, []string{previousKey.Type() + " " + gossh.FingerprintSHA256(previousKey)}, prompt.Expected)
	require.NoError(t, fixture.sessions.DecideHostKey(prompt.AttemptID, false))
	result := waitJumpTerminal(t, results)
	require.ErrorContains(t, result.err, "host key change rejected by user")
	assert.Empty(t, result.terminalID)
	assertNoJumpServiceResources(t, fixture)
}

func TestSSHJumpTerminalRejectsInvalidRequestBeforeDial(t *testing.T) {
	fixture := newJumpServiceFixture(t, newManualHostKeyEventBus(), "")
	for _, requestID := range []string{"", "bad request", strings.Repeat("a", connectionRequestIDLimit+1)} {
		result := waitJumpTerminal(t, startJumpTerminal(t, fixture, requestID))
		require.ErrorContains(t, result.err, "request id")
		assert.Empty(t, result.terminalID)
	}
	assert.Empty(t, jumpServiceFingerprints(fixture.bus))
	assert.Empty(t, jumpServiceProgress(fixture.bus))
	assert.False(t, fixture.bus.hasEvent(event.ConnectionAttempt))
	assertNoJumpServiceResources(t, fixture)
}

func TestSSHJumpTestNeedsNoTargetConnectionAndAcceptsNilContext(t *testing.T) {
	fixture := newJumpServiceFixture(t, newMockEventBus(), "127.0.0.1:0")
	require.NoError(t, fixture.sessions.TestSSHJumpHost(nil, model.SSHJumpHostTestInput{
		SessionID: fixture.session.ID, RequestID: "jump-only-connectivity-test", JumpHost: *fixture.session.JumpHost,
	}))
	prompts := jumpServiceFingerprints(fixture.bus)
	require.Len(t, prompts, 1)
	assert.True(t, prompts[0].IsJumpHost)
	assert.Len(t, jumpServiceProgress(fixture.bus), 1)
	assertNoJumpServiceResources(t, fixture)
}
