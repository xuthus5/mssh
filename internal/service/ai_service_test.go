package service

import (
	"database/sql"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type aiTerminalStub struct {
	writes   []string
	writeErr error
}

func (s *aiTerminalStub) Write(_ string, data string) (int, error) {
	if s.writeErr != nil {
		return 0, s.writeErr
	}
	s.writes = append(s.writes, data)
	return len(data), nil
}

type aiMemoryKeychain struct {
	data      map[string][]byte
	available bool
	err       error
}

func (k *aiMemoryKeychain) Get(_, account string) ([]byte, error) {
	if k.err != nil {
		return nil, k.err
	}
	return append([]byte(nil), k.data[account]...), nil
}

func (k *aiMemoryKeychain) Set(_, account string, data []byte) error {
	if k.err != nil {
		return k.err
	}
	k.data[account] = append([]byte(nil), data...)
	return nil
}

func (k *aiMemoryKeychain) Delete(_, account string) error {
	if k.err != nil {
		return k.err
	}
	delete(k.data, account)
	return nil
}

func (k *aiMemoryKeychain) IsAvailable() bool { return k.available }

func (s *aiTerminalStub) SystemInfo(string) (*model.SystemInfo, error) {
	return &model.SystemInfo{OSName: "Linux", KernelVersion: "6.0", CPUPercent: 12, Load1: 0.5, MemoryUsed: 1, MemoryTotal: 2}, nil
}

func TestAIServiceChatAndExecute(t *testing.T) {
	db := testutil.NewTestDB(t)
	session := createAIServiceSession(t, db)
	server := aiTestServer(t, http.StatusOK, `{"choices":[{"message":{"content":"检查完成\nCOMMAND: systemctl status nginx | PURPOSE: 检查服务"}}]}`)
	defer server.Close()
	terminal := &aiTerminalStub{}
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	service.terminals = terminal
	service.httpClient = server.Client()
	provider, err := service.SaveProvider(model.AIProviderProfileInput{Name: "test", Provider: model.AIProviderOpenAICompatible, BaseURL: server.URL, DefaultModel: "model", Enabled: true, APIKey: "secret"})
	require.NoError(t, err)
	settings := defaultAISettings()
	settings.DefaultProviderID = &provider.ID
	require.NoError(t, store.SaveAISettings(db, settings))
	response, err := service.Chat(model.AIChatRequest{SessionID: session.ID, TerminalID: "term-1", Prompt: "检查服务", TerminalContext: "password=hidden"})
	require.NoError(t, err)
	require.Len(t, response.Commands, 1)
	assert.Equal(t, model.AICommandRiskReadOnly, response.Commands[0].Risk)
	require.NoError(t, service.ExecuteCommand(model.AICommandExecutionInput{ConversationID: response.ConversationID, SessionID: session.ID, TerminalID: "term-1", Command: response.Commands[0].Command, Approved: true}))
	assert.Equal(t, []string{"systemctl status nginx\n"}, terminal.writes)
}

func TestAIServiceFallsBackOnServerError(t *testing.T) {
	db := testutil.NewTestDB(t)
	primaryServer := aiTestServer(t, http.StatusBadGateway, `bad gateway`)
	defer primaryServer.Close()
	fallbackServer := aiTestServer(t, http.StatusOK, `{"choices":[{"message":{"content":"fallback"}}]}`)
	defer fallbackServer.Close()
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	primary, err := service.SaveProvider(model.AIProviderProfileInput{Name: "primary", Provider: model.AIProviderOpenAICompatible, BaseURL: primaryServer.URL, DefaultModel: "model", Enabled: true, APIKey: "one"})
	require.NoError(t, err)
	fallback, err := service.SaveProvider(model.AIProviderProfileInput{Name: "fallback", Provider: model.AIProviderOpenAICompatible, BaseURL: fallbackServer.URL, DefaultModel: "model", Enabled: true, APIKey: "two"})
	require.NoError(t, err)
	settings := defaultAISettings()
	settings.DefaultProviderID, settings.FallbackProviderID = &primary.ID, &fallback.ID
	answer, providerID, err := service.chatWithFallback(settings, aiChatInput{Prompt: "hello"})
	require.NoError(t, err)
	assert.Equal(t, "fallback", answer)
	assert.Equal(t, fallback.ID, providerID)
}

func TestAIServiceBlocksDangerousCommand(t *testing.T) {
	db := testutil.NewTestDB(t)
	session := createAIServiceSession(t, db)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	service.terminals = &aiTerminalStub{}
	err := service.ExecuteCommand(model.AICommandExecutionInput{SessionID: session.ID, TerminalID: "term-1", Command: "rm -rf /", Approved: true})
	assert.ErrorContains(t, err, "blocked")
	assert.Empty(t, service.terminals.(*aiTerminalStub).writes)
}

func TestAIServiceDashboardSettingsAndProviderLifecycle(t *testing.T) {
	db := testutil.NewTestDB(t)
	keychain := &aiMemoryKeychain{data: make(map[string][]byte), available: true}
	service := NewAIService(db, nil, keychain, testutil.NewTestLogger())
	provider, err := service.SaveProvider(model.AIProviderProfileInput{Name: "main", Provider: model.AIProviderOpenAICompatible, BaseURL: "https://api.openai.com/v1", DefaultModel: "model", Enabled: true, APIKey: "secret"})
	require.NoError(t, err)
	input := aiSettingsInput(defaultAISettings())
	input.DefaultProviderID = &provider.ID
	input.Search.Enabled = true
	input.Search.APIKey = "search-secret"
	require.NoError(t, service.SaveSettings(input))
	dashboard, err := service.Dashboard()
	require.NoError(t, err)
	require.Len(t, dashboard.Providers, 1)
	assert.True(t, dashboard.Providers[0].CredentialSaved)
	assert.True(t, dashboard.Settings.Search.CredentialSaved)
	assert.True(t, dashboard.KeychainAvailable)
	require.NoError(t, service.DeleteProvider(provider.ID))
	dashboard, err = service.Dashboard()
	require.NoError(t, err)
	assert.Empty(t, dashboard.Providers)
}

func TestAIServiceValidatesSettingsAndProvider(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	_, err := service.SaveProvider(model.AIProviderProfileInput{Name: "", Provider: model.AIProviderOpenAICompatible, DefaultModel: ""})
	assert.ErrorContains(t, err, "required")
	_, err = service.SaveProvider(model.AIProviderProfileInput{Name: "bad", Provider: model.AIProviderOpenAICompatible, BaseURL: "http://example.com", DefaultModel: "model"})
	assert.ErrorContains(t, err, "HTTPS")
	input := aiSettingsInput(defaultAISettings())
	input.Security.RedactionPatterns = []string{"["}
	assert.ErrorContains(t, service.SaveSettings(input), "regular expression")
	input = aiSettingsInput(defaultAISettings())
	input.Interaction.PanelWidth = 100
	assert.ErrorContains(t, service.SaveSettings(input), "panel width")
}

func TestAIServiceTestProviderAndConversationMethods(t *testing.T) {
	db := testutil.NewTestDB(t)
	session := createAIServiceSession(t, db)
	server := aiTestServer(t, http.StatusOK, `{"choices":[{"message":{"content":"OK"}}]}`)
	defer server.Close()
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	service.httpClient = server.Client()
	provider, err := service.SaveProvider(model.AIProviderProfileInput{Name: "test", Provider: model.AIProviderOpenAICompatible, BaseURL: server.URL, DefaultModel: "model", Enabled: true, APIKey: "secret"})
	require.NoError(t, err)
	require.NoError(t, service.TestProvider(provider.ID))
	conversationID, err := store.CreateAIConversation(db, session.ID, "history")
	require.NoError(t, err)
	require.NoError(t, store.AddAIMessage(db, conversationID, "user", "hello"))
	conversations, err := service.ListConversations(session.ID, 0)
	require.NoError(t, err)
	assert.Len(t, conversations, 1)
	messages, err := service.ListMessages(conversationID)
	require.NoError(t, err)
	assert.Len(t, messages, 1)
	require.NoError(t, service.DeleteConversation(conversationID))
}

func TestAIServiceExecutionErrors(t *testing.T) {
	db := testutil.NewTestDB(t)
	session := createAIServiceSession(t, db)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	err := service.ExecuteCommand(model.AICommandExecutionInput{SessionID: session.ID, TerminalID: "term", Command: "echo change"})
	assert.ErrorContains(t, err, "approval")
	service.terminals = &aiTerminalStub{writeErr: errors.New("write failed")}
	err = service.ExecuteCommand(model.AICommandExecutionInput{SessionID: session.ID, TerminalID: "term", Command: "echo change", Approved: true})
	assert.ErrorContains(t, err, "write failed")
}

func TestAIServiceChatValidationSearchAndExistingConversation(t *testing.T) {
	db := testutil.NewTestDB(t)
	session := createAIServiceSession(t, db)
	providerServer := aiTestServer(t, http.StatusOK, `{"choices":[{"message":{"content":"answer"}}]}`)
	defer providerServer.Close()
	searchServer := aiTestServer(t, http.StatusOK, `{"web":{"results":[{"title":"Docs","url":"https://example.com","description":"result"}]}}`)
	defer searchServer.Close()
	restoreSearchEndpoint(t, model.AISearchProviderBrave, searchServer.URL)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	service.httpClient = providerServer.Client()
	provider, err := service.SaveProvider(model.AIProviderProfileInput{Name: "test", Provider: model.AIProviderOpenAICompatible, BaseURL: providerServer.URL, DefaultModel: "model", Enabled: true, APIKey: "secret"})
	require.NoError(t, err)
	settings := defaultAISettings()
	settings.DefaultProviderID = &provider.ID
	settings.Search.Enabled = true
	service.secrets.set(searchSecretAccount(settings.Search.Provider), "search-secret")
	require.NoError(t, store.SaveAISettings(db, settings))
	conversationID, err := store.CreateAIConversation(db, session.ID, "existing")
	require.NoError(t, err)
	response, err := service.Chat(model.AIChatRequest{ConversationID: conversationID, SessionID: session.ID, TerminalID: "term", Prompt: "search", UseSearch: true})
	require.NoError(t, err)
	assert.Equal(t, conversationID, response.ConversationID)
	require.Len(t, response.Citations, 1)
	_, err = service.Chat(model.AIChatRequest{})
	assert.ErrorContains(t, err, "required")
}

func TestAIServiceProviderLoadingErrors(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	_, _, err := service.loadProvider(999)
	assert.ErrorContains(t, err, "unavailable")
	provider, err := store.SaveAIProviderProfile(db, model.AIProviderProfileInput{Name: "disabled", Provider: model.AIProviderOpenAICompatible, BaseURL: "https://example.com", DefaultModel: "model", Enabled: false})
	require.NoError(t, err)
	_, _, err = service.loadProvider(provider.ID)
	assert.ErrorContains(t, err, "unavailable")
	provider, err = store.SaveAIProviderProfile(db, model.AIProviderProfileInput{Name: "missing key", Provider: model.AIProviderOpenAICompatible, BaseURL: "https://example.com", DefaultModel: "model", Enabled: true})
	require.NoError(t, err)
	_, _, err = service.loadProvider(provider.ID)
	assert.ErrorContains(t, err, "no API key")
	_, _, err = service.chatWithFallback(defaultAISettings(), aiChatInput{})
	assert.ErrorContains(t, err, "no AI provider")
}

func TestAIServiceDashboardToleratesCredentialReadFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	keychain := &aiMemoryKeychain{data: make(map[string][]byte), available: true, err: assert.AnError}
	service := NewAIService(db, nil, keychain, testutil.NewTestLogger())
	_, err := store.SaveAIProviderProfile(db, model.AIProviderProfileInput{Name: "test", Provider: model.AIProviderOpenAICompatible, BaseURL: "https://example.com", DefaultModel: "model", Enabled: true})
	require.NoError(t, err)
	dashboard, err := service.Dashboard()
	require.NoError(t, err)
	require.Len(t, dashboard.Providers, 1)
	assert.False(t, dashboard.Providers[0].CredentialSaved)
}

func TestNewAIServiceAcceptsTerminalController(t *testing.T) {
	service := NewAIService(testutil.NewTestDB(t), &TerminalService{}, nil, testutil.NewTestLogger())
	assert.NotNil(t, service.terminals)
}

func aiSettingsInput(settings model.AISettings) model.AISettingsInput {
	return model.AISettingsInput{DefaultProviderID: settings.DefaultProviderID, FallbackProviderID: settings.FallbackProviderID, Interaction: settings.Interaction, Search: model.AISearchSettingsInput{Enabled: settings.Search.Enabled, Mode: settings.Search.Mode, Provider: settings.Search.Provider, TimeoutSeconds: settings.Search.TimeoutSeconds, MaxResults: settings.Search.MaxResults, RequireCitations: settings.Search.RequireCitations}, Security: settings.Security}
}

func aiTestServer(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(status)
		_, err := writer.Write([]byte(body))
		require.NoError(t, err)
	}))
}

func createAIServiceSession(t *testing.T, db *sql.DB) *model.Session {
	t.Helper()
	session, err := store.CreateSession(db, model.Session{Name: "prod", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, KeepAlive: 30})
	require.NoError(t, err)
	return session
}

type slowAITerminalStub struct {
	delay time.Duration
}

func (s *slowAITerminalStub) Write(_ string, data string) (int, error) {
	time.Sleep(s.delay)
	return len(data), nil
}

func (s *slowAITerminalStub) SystemInfo(string) (*model.SystemInfo, error) {
	return &model.SystemInfo{}, nil
}

func TestAIServiceExecuteCommandWriteTimeout(t *testing.T) {
	db := testutil.NewTestDB(t)
	session := createAIServiceSession(t, db)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	service.terminals = &slowAITerminalStub{delay: 200 * time.Millisecond}
	settings := defaultAISettings()
	settings.Security.CommandTimeoutSeconds = 1
	// Use sub-second by writing through helper directly with short timeout.
	err := writeTerminalWithTimeout(service.terminals, "term", "echo ok\n", 50*time.Millisecond)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "timed out")

	// Fast path still succeeds.
	service.terminals = &aiTerminalStub{}
	require.NoError(t, service.ExecuteCommand(model.AICommandExecutionInput{
		SessionID: session.ID, TerminalID: "term", Command: "echo ok", Approved: true,
	}))
}

func TestAIServiceExecuteCommandRejectsOversizedCommand(t *testing.T) {
	db := testutil.NewTestDB(t)
	session := createAIServiceSession(t, db)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	service.terminals = &aiTerminalStub{}
	huge := strings.Repeat("a", maxAICommandBytes)
	err := service.ExecuteCommand(model.AICommandExecutionInput{
		SessionID: session.ID, TerminalID: "term", Command: huge, Approved: true,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "size limit")
	assert.Empty(t, service.terminals.(*aiTerminalStub).writes)
}

func TestAIServiceClampsTerminalContext(t *testing.T) {
	db := testutil.NewTestDB(t)
	session := createAIServiceSession(t, db)
	var seenContext string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		seenContext = string(body)
		_, _ = writer.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer server.Close()
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	service.httpClient = server.Client()
	provider, err := service.SaveProvider(model.AIProviderProfileInput{Name: "ctx", Provider: model.AIProviderOpenAICompatible, BaseURL: server.URL, DefaultModel: "model", Enabled: true, APIKey: "secret"})
	require.NoError(t, err)
	settings := defaultAISettings()
	settings.DefaultProviderID = &provider.ID
	settings.Security.MaxOutputBytes = 32
	settings.Interaction.IncludeSessionMetadata = false
	settings.Interaction.IncludeSystemSummary = false
	require.NoError(t, store.SaveAISettings(db, settings))
	huge := strings.Repeat("x", 10_000)
	_, err = service.Chat(model.AIChatRequest{SessionID: session.ID, TerminalID: "term-1", Prompt: "ping", TerminalContext: huge})
	require.NoError(t, err)
	require.NotEmpty(t, seenContext)
	assert.LessOrEqual(t, strings.Count(seenContext, "x"), 32+100) // body includes JSON framing
	assert.NotContains(t, seenContext, strings.Repeat("x", 200))
}

func TestAIServiceExecuteCommandRejectsInvalidIDs(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	service.terminals = &aiTerminalStub{}
	err := service.ExecuteCommand(model.AICommandExecutionInput{SessionID: 0, TerminalID: "term", Command: "echo 1", Approved: true})
	require.Error(t, err)
	err = service.ExecuteCommand(model.AICommandExecutionInput{SessionID: 1, TerminalID: "  ", Command: "echo 1", Approved: true})
	require.Error(t, err)
}

func TestAIServiceChatRejectsBlankTerminalID(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	_, err := service.Chat(model.AIChatRequest{SessionID: 1, TerminalID: "  ", Prompt: "hi"})
	require.Error(t, err)
}
