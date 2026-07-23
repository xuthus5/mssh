package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/store"
)

type aiTerminalWriter interface {
	Write(terminalID string, data string) (int, error)
	SystemInfo(terminalID string) (*model.SystemInfo, error)
}

type AIService struct {
	db         *sql.DB
	terminals  aiTerminalWriter
	secrets    *aiSecretStore
	httpClient *http.Client
	logger     *slog.Logger
}

func NewAIService(db *sql.DB, terminals *TerminalService, keychain crypto.KeychainAdapter, logger *slog.Logger, proxy ...*netproxy.Manager) *AIService {
	var terminalController aiTerminalWriter
	if terminals != nil {
		terminalController = terminals
	}
	return &AIService{db: db, terminals: terminalController, secrets: newAISecretStore(keychain), httpClient: sharedHTTPClient(45*time.Second, firstProxy(proxy...)), logger: logger}
}

func (s *AIService) Dashboard() (model.AISettingsDashboard, error) {
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
	if id <= 0 {
		return fmt.Errorf("invalid provider id")
	}
	if err := store.DeleteAIProviderProfile(s.db, id); err != nil {
		return err
	}
	if err := s.secrets.delete(providerSecretAccount(id)); err != nil {
		return err
	}
	recordAudit(s.db, s.logger, model.AuditEvent{Action: "ai_provider_delete", TargetType: "ai_provider", TargetID: fmt.Sprint(id), Summary: "删除 AI 提供商配置", Outcome: "success"})
	return nil
}

func (s *AIService) SaveSettings(input model.AISettingsInput) error {
	settings := model.AISettings{DefaultProviderID: input.DefaultProviderID, FallbackProviderID: input.FallbackProviderID, Interaction: input.Interaction, Search: model.AISearchSettings{Enabled: input.Search.Enabled, Mode: input.Search.Mode, Provider: input.Search.Provider, TimeoutSeconds: input.Search.TimeoutSeconds, MaxResults: input.Search.MaxResults, RequireCitations: input.Search.RequireCitations}, Security: input.Security}
	if err := validateAISettings(settings); err != nil {
		return err
	}
	if err := validateAIRegexSettings(settings.Security); err != nil {
		return err
	}
	if input.Search.APIKey != "" {
		s.secrets.set(searchSecretAccount(input.Search.Provider), input.Search.APIKey)
	}
	if err := store.SaveAISettings(s.db, settings); err != nil {
		return err
	}
	return store.PruneAIConversations(s.db, settings.Interaction.HistoryRetentionDays, settings.Interaction.MaxConversations)
}

func (s *AIService) TestProvider(id int64) error {
	profile, secret, err := s.loadProvider(id)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_, err = chatWithProvider(ctx, s.httpClient, *profile, secret, aiChatInput{System: "只回复 OK。", Prompt: "连接测试", Context: ""})
	return err
}

func validateAIRegexSettings(settings model.AISecuritySettings) error {
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
	maxAIProviderNameRunes   = 128
	maxAIProviderModelRunes  = 256
	maxAIProviderURLBytes    = 2048
	maxAIProviderAPIKeyBytes = 8 * 1024
)

func validateAIProviderFields(input model.AIProviderProfileInput) error {
	if strings.ContainsRune(input.Name, 0) || strings.ContainsRune(input.DefaultModel, 0) || strings.ContainsRune(input.BaseURL, 0) {
		return errors.New("AI provider fields must not contain NUL")
	}
	if utf8.RuneCountInString(input.Name) > maxAIProviderNameRunes {
		return fmt.Errorf("provider name must not exceed %d characters", maxAIProviderNameRunes)
	}
	if utf8.RuneCountInString(input.DefaultModel) > maxAIProviderModelRunes {
		return fmt.Errorf("default model must not exceed %d characters", maxAIProviderModelRunes)
	}
	if len(input.BaseURL) > maxAIProviderURLBytes {
		return fmt.Errorf("provider URL must not exceed %d bytes", maxAIProviderURLBytes)
	}
	if len(input.APIKey) > maxAIProviderAPIKeyBytes {
		return fmt.Errorf("API key exceeds size limit")
	}
	switch input.Provider {
	case model.AIProviderOpenAICompatible, model.AIProviderAnthropic, model.AIProviderGemini, model.AIProviderOllama:
	default:
		return fmt.Errorf("unsupported AI provider %s", input.Provider)
	}
	return nil
}
