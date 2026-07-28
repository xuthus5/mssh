package service

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type blockingAIKeychain struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func newBlockingAIKeychain() *blockingAIKeychain {
	return &blockingAIKeychain{started: make(chan struct{}), release: make(chan struct{})}
}

func (k *blockingAIKeychain) Get(_, _ string) ([]byte, error) {
	k.once.Do(func() { close(k.started) })
	<-k.release
	return []byte("secret"), nil
}

func (k *blockingAIKeychain) Set(_, _ string, _ []byte) error { return nil }

func (k *blockingAIKeychain) Delete(_, _ string) error { return nil }

func (k *blockingAIKeychain) IsAvailable() bool { return true }

type cancelAwareAIRoundTripper struct {
	started    chan struct{}
	canceled   chan struct{}
	startOnce  sync.Once
	cancelOnce sync.Once
	calls      atomic.Int32
}

type shutdownAITerminalWriter struct {
	started   chan struct{}
	release   chan struct{}
	startOnce sync.Once
	closeOnce sync.Once
	closed    atomic.Bool
	sessionID int64
}

func newShutdownAITerminalWriter(sessionID int64) *shutdownAITerminalWriter {
	return &shutdownAITerminalWriter{started: make(chan struct{}), release: make(chan struct{}), sessionID: sessionID}
}

func (w *shutdownAITerminalWriter) Write(_ string, _ string) (int, error) {
	w.startOnce.Do(func() { close(w.started) })
	<-w.release
	return 0, errors.New("terminal closed")
}

func (w *shutdownAITerminalWriter) Close(string) error {
	w.closed.Store(true)
	w.closeOnce.Do(func() { close(w.release) })
	return nil
}

func (w *shutdownAITerminalWriter) SystemInfo(string) (*model.SystemInfo, error) {
	return &model.SystemInfo{}, nil
}

func (w *shutdownAITerminalWriter) terminalSessionID(string) (int64, bool) {
	return w.sessionID, w.sessionID > 0
}

func newCancelAwareAIRoundTripper() *cancelAwareAIRoundTripper {
	return &cancelAwareAIRoundTripper{started: make(chan struct{}), canceled: make(chan struct{})}
}

func (r *cancelAwareAIRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	r.calls.Add(1)
	r.startOnce.Do(func() { close(r.started) })
	<-request.Context().Done()
	r.cancelOnce.Do(func() { close(r.canceled) })
	return nil, request.Context().Err()
}

func TestAIServiceShutdownWaitsForActiveOperation(t *testing.T) {
	database := testutil.NewTestDB(t)
	keychain := newBlockingAIKeychain()
	t.Cleanup(func() {
		select {
		case <-keychain.release:
		default:
			close(keychain.release)
		}
	})
	service := NewAIService(database, nil, keychain, testutil.NewTestLogger())
	provider := saveAIShutdownProvider(t, database)
	service.httpClient = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("offline")
	})}

	requestDone := make(chan error, 1)
	go func() { requestDone <- service.TestProvider(provider.ID) }()
	<-keychain.started
	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()

	select {
	case <-shutdownDone:
		t.Fatal("shutdown returned before the active AI operation completed")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, database.Ping())
	close(keychain.release)
	require.Error(t, <-requestDone)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not finish after the AI operation completed")
	}
	service.Shutdown()
}

func TestAIServiceShutdownCancelsNetworkOperation(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewAIService(database, nil, nil, testutil.NewTestLogger())
	provider := saveAIShutdownProvider(t, database)
	service.secrets.set(providerSecretAccount(provider.ID), "secret")
	transport := newCancelAwareAIRoundTripper()
	service.httpClient = &http.Client{Transport: transport}

	requestDone := make(chan error, 1)
	go func() { requestDone <- service.TestProvider(provider.ID) }()
	select {
	case <-transport.started:
	case requestErr := <-requestDone:
		t.Fatalf("AI request ended before reaching the transport: %v", requestErr)
	case <-time.After(time.Second):
		t.Fatal("AI request did not reach the transport")
	}
	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()

	select {
	case <-transport.canceled:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not cancel the active AI request")
	}
	require.ErrorIs(t, <-requestDone, context.Canceled)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not wait for the canceled AI request")
	}
	require.NoError(t, database.Ping())
	assert.Equal(t, int32(1), transport.calls.Load())
}

func TestAIServiceShutdownCancelsTerminalCommand(t *testing.T) {
	database := testutil.NewTestDB(t)
	session := createAIServiceSession(t, database)
	terminal := newShutdownAITerminalWriter(session.ID)
	t.Cleanup(func() { _ = terminal.Close("term") })
	service := NewAIService(database, nil, nil, testutil.NewTestLogger())
	service.terminals = terminal
	settings := defaultAISettings()
	settings.Security.CommandTimeoutSeconds = 30
	require.NoError(t, store.SaveAISettings(database, settings))

	requestDone := make(chan error, 1)
	go func() {
		requestDone <- service.ExecuteCommand(model.AICommandExecutionInput{
			SessionID: session.ID, TerminalID: "term", Command: "uptime", Approved: true,
		})
	}()
	select {
	case <-terminal.started:
	case <-time.After(time.Second):
		t.Fatal("AI command did not reach the terminal")
	}
	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()

	requestErr := <-requestDone
	require.Error(t, requestErr)
	assert.ErrorContains(t, requestErr, "context canceled")
	assert.True(t, terminal.closed.Load())
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not wait for the canceled AI command")
	}
	require.NoError(t, database.Ping())
}

func TestAIServiceRejectsOperationsAfterShutdown(t *testing.T) {
	service := NewAIService(testutil.NewTestDB(t), nil, nil, testutil.NewTestLogger())
	service.secrets.set("session-only", "secret")
	service.Shutdown()
	service.secrets.mu.RLock()
	assert.Empty(t, service.secrets.volatile)
	service.secrets.mu.RUnlock()

	_, err := service.Dashboard()
	assertAIServiceStopped(t, err)
	_, err = service.SaveProvider(model.AIProviderProfileInput{})
	assertAIServiceStopped(t, err)
	assertAIServiceStopped(t, service.DeleteProvider(1))
	assertAIServiceStopped(t, service.SaveSettings(model.AISettingsInput{}))
	assertAIServiceStopped(t, service.TestProvider(1))
	_, err = service.Chat(model.AIChatRequest{})
	assertAIServiceStopped(t, err)
	assertAIServiceStopped(t, service.ExecuteCommand(model.AICommandExecutionInput{}))
	_, err = service.ListConversations(1, 1)
	assertAIServiceStopped(t, err)
	_, err = service.ListMessages(1)
	assertAIServiceStopped(t, err)
	assertAIServiceStopped(t, service.DeleteConversation(1))
	assert.Empty(t, service.DetectAgentCLIs())
}

func TestAIServiceShutdownHandlesNilReceiver(t *testing.T) {
	var service *AIService
	assert.NotPanics(t, service.Shutdown)
}

func saveAIShutdownProvider(t *testing.T, database *sql.DB) *model.AIProviderProfile {
	t.Helper()
	provider, err := store.SaveAIProviderProfile(database, model.AIProviderProfileInput{
		Name: "shutdown", Provider: model.AIProviderOpenAICompatible,
		BaseURL: "https://api.openai.com/v1", DefaultModel: "model", Enabled: true,
	})
	require.NoError(t, err)
	return provider
}

func assertAIServiceStopped(t *testing.T, err error) {
	t.Helper()
	require.Error(t, err)
	assert.ErrorContains(t, err, "AI service is shutting down")
}
