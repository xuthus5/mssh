package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/store"
)

type terminalCommandWriter interface {
	Write(terminalID string, data string) (int, error)
	Close(terminalID string) error
}

type aiTerminalWriter interface {
	terminalCommandWriter
	SystemInfo(terminalID string) (*model.SystemInfo, error)
	terminalSessionID(terminalID string) (int64, bool)
}

type AIService struct {
	db             *sql.DB
	terminals      aiTerminalWriter
	secrets        *aiSecretStore
	httpClient     *http.Client
	logger         *slog.Logger
	lifecycle      aiServiceLifecycle
	configMu       sync.RWMutex
	modelsDevMu    sync.Mutex
	modelsDevURL   string
	modelsDevCache model.ModelsDevCatalog
}

func NewAIService(db *sql.DB, terminals *TerminalService, keychain crypto.KeychainAdapter, logger *slog.Logger, proxy ...*netproxy.Manager) *AIService {
	var terminalController aiTerminalWriter
	if terminals != nil {
		terminalController = terminals
	}
	return &AIService{db: db, terminals: terminalController, secrets: newAISecretStore(keychain), httpClient: sharedHTTPClient(45*time.Second, firstProxy(proxy...)), logger: logger, modelsDevURL: modelsDevAPIURL}
}

func (s *AIService) Dashboard() (model.AISettingsDashboard, error) {
	_, finish, err := s.beginOperation()
	if err != nil {
		return model.AISettingsDashboard{}, err
	}
	defer finish()
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	settings, err := store.LoadAISettings(s.db, defaultAISettings())
	if err != nil {
		return model.AISettingsDashboard{}, err
	}
	profiles, err := store.ListAIProviderProfiles(s.db)
	if err != nil {
		return model.AISettingsDashboard{}, err
	}
	for index := range profiles {
		saved, sessionOnly, secretErr := s.providerSecretState(profiles[index].ID)
		if secretErr != nil {
			s.logger.Warn("read AI provider credential state failed", "providerID", profiles[index].ID, "error", secretErr)
		}
		profiles[index].CredentialSaved = saved
		profiles[index].CredentialSessionOnly = sessionOnly
	}
	s.enrichSearchSecretState(&settings)
	return model.AISettingsDashboard{Settings: settings, Providers: profiles, KeychainAvailable: s.secrets.keychain != nil && s.secrets.keychain.IsAvailable()}, nil
}

func (s *AIService) SaveProvider(input model.AIProviderProfileInput) (*model.AIProviderProfile, error) {
	_, finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	s.configMu.Lock()
	defer s.configMu.Unlock()
	if input.ID < 0 {
		return nil, fmt.Errorf("invalid provider id")
	}
	input.Name = strings.TrimSpace(input.Name)
	input.BaseURL = strings.TrimSpace(input.BaseURL)
	input.DefaultModel = strings.TrimSpace(input.DefaultModel)
	if input.Name == "" || input.DefaultModel == "" {
		return nil, errors.New("provider name and default model are required")
	}
	if err := validateAIProviderFields(input); err != nil {
		return nil, err
	}
	if err := validateProviderURL(model.AIProviderProfile{Provider: input.Provider, BaseURL: input.BaseURL}); err != nil {
		return nil, err
	}
	if err := s.validateProviderCredentialRoute(input); err != nil {
		return nil, err
	}
	if err := s.ensureProviderCanBeDisabled(input); err != nil {
		return nil, err
	}
	profile, err := store.SaveAIProviderProfile(s.db, input)
	if err != nil {
		return nil, err
	}
	if input.APIKey != "" {
		profile.CredentialSaved = s.secrets.set(providerSecretAccount(profile.ID), input.APIKey)
		profile.CredentialSessionOnly = !profile.CredentialSaved
	} else {
		profile.CredentialSaved, profile.CredentialSessionOnly, _ = s.providerSecretState(profile.ID)
	}
	recordAudit(s.db, s.logger, model.AuditEvent{Action: "ai_provider_save", TargetType: "ai_provider", TargetID: fmt.Sprint(profile.ID), Summary: "保存 AI 提供商配置", Outcome: "success"})
	return profile, nil
}

func (s *AIService) DeleteProvider(id int64) error {
	_, finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	s.configMu.Lock()
	defer s.configMu.Unlock()
	if id <= 0 {
		return fmt.Errorf("invalid provider id")
	}
	profile, err := store.GetAIProviderProfile(s.db, id)
	if err != nil {
		return err
	}
	if profile == nil {
		return fmt.Errorf("AI provider %d not found", id)
	}
	account := providerSecretAccount(id)
	secret, secretExists, err := s.secrets.get(account)
	if err != nil {
		return err
	}
	secretSnapshot := aiProviderSecretSnapshot{
		account: account, value: secret, exists: secretExists,
		sessionOnly: s.secrets.isVolatile(account),
	}
	if err := s.secrets.delete(account); err != nil {
		return err
	}
	if err := store.DeleteAIProviderProfile(s.db, id); err != nil {
		return s.restoreProviderSecret(secretSnapshot, err)
	}
	recordAudit(s.db, s.logger, model.AuditEvent{Action: "ai_provider_delete", TargetType: "ai_provider", TargetID: fmt.Sprint(id), Summary: "删除 AI 提供商配置", Outcome: "success"})
	return nil
}

func (s *AIService) SaveSettings(input model.AISettingsInput) error {
	_, finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	s.configMu.Lock()
	defer s.configMu.Unlock()
	settings := model.AISettings{DefaultProviderID: input.DefaultProviderID, FallbackProviderID: input.FallbackProviderID, Interaction: input.Interaction, Search: model.AISearchSettings{Enabled: input.Search.Enabled, Mode: input.Search.Mode, Provider: input.Search.Provider, TimeoutSeconds: input.Search.TimeoutSeconds, MaxResults: input.Search.MaxResults, RequireCitations: input.Search.RequireCitations}, Security: input.Security}
	if err := validateAISettings(settings); err != nil {
		return err
	}
	if err := validateAISearchAPIKey(input.Search.APIKey); err != nil {
		return err
	}
	if err := validateAIRegexSettings(settings.Security); err != nil {
		return err
	}
	if err := s.validateAIProviderPriorities(settings); err != nil {
		return err
	}
	if err := s.validateAISearchCredential(input.Search); err != nil {
		return err
	}
	if err := store.SaveAISettingsAndPrune(s.db, settings); err != nil {
		return err
	}
	if input.Search.APIKey != "" {
		s.secrets.set(searchSecretAccount(input.Search.Provider), input.Search.APIKey)
	}
	return nil
}

func (s *AIService) validateProviderCredentialRoute(input model.AIProviderProfileInput) error {
	if input.ID == 0 || input.APIKey != "" || input.Provider == model.AIProviderOllama {
		return nil
	}
	current, err := store.GetAIProviderProfile(s.db, input.ID)
	if err != nil {
		return err
	}
	if current == nil {
		return fmt.Errorf("AI provider %d not found", input.ID)
	}
	next := model.AIProviderProfile{Provider: input.Provider, BaseURL: input.BaseURL}
	if current.Provider == next.Provider && providerBaseURL(*current) == providerBaseURL(next) {
		return nil
	}
	return fmt.Errorf("API key must be re-entered when the AI provider type or base URL changes")
}

func (s *AIService) validateAISearchCredential(input model.AISearchSettingsInput) error {
	if !requiresExternalAISearchCredential(input.Enabled, input.Mode) || input.APIKey != "" {
		return nil
	}
	_, exists, err := s.secrets.get(searchSecretAccount(input.Provider))
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("AI search credential is required when external search is enabled")
	}
	return nil
}

func requiresExternalAISearchCredential(enabled bool, mode model.AISearchMode) bool {
	return enabled && mode != model.AISearchDisabled && mode != model.AISearchNative
}

func (s *AIService) TestProvider(id int64) error {
	operationContext, finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if id <= 0 {
		return fmt.Errorf("invalid provider id")
	}
	profile, secret, err := s.loadProvider(id)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(operationContext, 20*time.Second)
	defer cancel()
	_, err = chatWithProvider(ctx, s.httpClient, *profile, secret, aiChatInput{System: "只回复 OK。", Prompt: "连接测试", Context: ""})
	return err
}

func validateAIRegexSettings(settings model.AISecuritySettings) error {
	if err := validateAIRegexPatternCounts(settings); err != nil {
		return err
	}
	all := append(append([]string{}, settings.AllowPatterns...), settings.DenyPatterns...)
	all = append(all, settings.RedactionPatterns...)
	for _, expression := range all {
		if err := validateUserRegexp(expression); err != nil {
			return fmt.Errorf("invalid AI regular expression %q: %w", expression, err)
		}
	}
	return nil
}

func providerSecretAccount(id int64) string { return fmt.Sprintf("provider:%d", id) }

func searchSecretAccount(provider model.AISearchProvider) string { return "search:" + string(provider) }

const (
	maxAIProviderNameRunes    = 128
	maxAIProviderModelRunes   = 256
	maxAIProviderURLBytes     = 2048
	maxAIProviderAPIKeyBytes  = 8 * 1024
	maxAIContextWindowSize    = 1 << 22 // 4M tokens upper bound
	maxAIMaxTokens            = 1 << 22
	maxAICustomHeaderCount    = 32
	maxAICustomHeaderKeyRunes = 128
)
