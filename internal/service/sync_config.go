package service

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	syncConfigSetting         = "sync.config"
	syncDeviceIDSetting       = "sync.device_id"
	syncGistTokenSetting      = "sync.secret.gist_token"
	syncWebDAVPasswordSetting = "sync.secret.webdav_password"
	syncS3SecretSetting       = "sync.secret.s3_secret_key"
)

var allowedSyncIntervals = []int{0, 5, 15, 30, 60}

func WithSyncDataDir(dataDir string) SyncOption {
	return func(service *SyncService) { service.dataDir = dataDir }
}

func WithSyncSecretSource(source func() (string, error)) SyncOption {
	return func(service *SyncService) { service.secretSource = source }
}

func WithVaultSource(source func() (*backupcrypto.VaultFile, error)) SyncOption {
	return func(service *SyncService) { service.vaultSource = source }
}

func WithVaultTransactionInstaller(installer func(password string, vault backupcrypto.VaultFile) (VaultInstallTransaction, error)) SyncOption {
	return func(service *SyncService) { service.vaultTransactionInstaller = installer }
}

func WithSyncCrypto(crypto KeyCrypto) SyncOption {
	return func(service *SyncService) { service.crypto = crypto }
}

func WithSyncProxy(manager *netproxy.Manager) SyncOption {
	return func(service *SyncService) { service.proxyManager = manager }
}

func WithSyncRuntimeSettings(settings SyncRuntimeSettings) SyncOption {
	return func(service *SyncService) { service.runtimeSettings = settings }
}

func WithSyncEventBus(eventBus EventBus) SyncOption {
	return func(service *SyncService) { service.eventBus = eventBus }
}

func WithSyncLifecycle(lifecycle syncLifecycle) SyncOption {
	return func(service *SyncService) { service.lifecycle = lifecycle }
}

func WithSyncProviderFactory(factory syncProviderFactory) SyncOption {
	return func(service *SyncService) { service.providerFactory = factory }
}

func defaultSyncConfig() model.SyncConfig {
	return model.SyncConfig{
		Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart, IntervalMinutes: 15,
		RetentionCount: 30, RetentionDays: 90, S3: model.S3SyncConfig{Region: "us-east-1"},
	}
}

func (s *SyncService) LoadConfig() (model.SyncConfig, error) {
	finish, err := s.beginReadOperation()
	if err != nil {
		return model.SyncConfig{}, err
	}
	defer finish()
	return s.loadConfig()
}

func (s *SyncService) loadConfig() (model.SyncConfig, error) {
	config := defaultSyncConfig()
	if err := readSyncSetting(s.db, syncConfigSetting, &config); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return model.SyncConfig{}, err
	}
	config.Gist.TokenSaved = s.secretSaved(syncGistTokenSetting)
	config.WebDAV.PasswordSaved = s.secretSaved(syncWebDAVPasswordSetting)
	config.S3.SecretKeySaved = s.secretSaved(syncS3SecretSetting)
	config.MasterKeySaved = false
	if s.secretSource != nil {
		if _, err := s.secretSource(); err == nil {
			config.MasterKeySaved = true
		}
	}
	return config, nil
}

func (s *SyncService) SaveConfig(input model.SyncConfigInput) (model.SyncDashboard, error) {
	if err := s.lockSyncOperation(); err != nil {
		return model.SyncDashboard{}, err
	}
	defer s.operationMu.Unlock()
	s.configMu.Lock()
	err := s.saveConfig(input)
	s.configMu.Unlock()
	if err != nil {
		return model.SyncDashboard{}, err
	}
	s.restartScheduler()
	return s.dashboard()
}

func (s *SyncService) saveConfig(input model.SyncConfigInput) error {
	config := configFromInput(input)
	if err := validateSyncConfig(config); err != nil {
		return err
	}
	previous, err := s.loadConfig()
	if err != nil {
		return err
	}
	changedProvider := providerChanged(previous, config)
	err = withCryptoOperation(s.crypto, func() error {
		return s.persistSyncConfig(input, previous, config)
	})
	if err != nil {
		return err
	}
	if changedProvider {
		s.setRuntimeState(syncRuntimeState{State: model.SyncStatePending})
	}
	return nil
}

func configFromInput(input model.SyncConfigInput) model.SyncConfig {
	return model.SyncConfig{
		Enabled: input.Enabled, Provider: input.Provider, Strategy: input.Strategy,
		IntervalMinutes: input.IntervalMinutes, RetentionCount: input.RetentionCount, RetentionDays: input.RetentionDays,
		Gist:   model.GistSyncConfig{GistID: strings.TrimSpace(input.Gist.GistID)},
		WebDAV: model.WebDAVSyncConfig{URL: strings.TrimSpace(input.WebDAV.URL), Username: strings.TrimSpace(input.WebDAV.Username)},
		S3: model.S3SyncConfig{Endpoint: strings.TrimSpace(input.S3.Endpoint), Region: strings.TrimSpace(input.S3.Region),
			Bucket: strings.TrimSpace(input.S3.Bucket), Prefix: strings.Trim(strings.TrimSpace(input.S3.Prefix), "/"),
			AccessKeyID: strings.TrimSpace(input.S3.AccessKeyID), PathStyle: input.S3.PathStyle},
	}
}

func validateSyncConfig(config model.SyncConfig) error {
	if config.Provider != model.SyncProviderGist && config.Provider != model.SyncProviderWebDAV && config.Provider != model.SyncProviderS3 {
		return errors.New("unsupported sync provider")
	}
	if config.Strategy != model.SyncStrategySmart && config.Strategy != model.SyncStrategyCloudFirst && config.Strategy != model.SyncStrategyLocalFirst {
		return errors.New("unsupported sync strategy")
	}
	if !slices.Contains(allowedSyncIntervals, config.IntervalMinutes) {
		return errors.New("sync interval must be 0, 5, 15, 30, or 60 minutes")
	}
	if config.RetentionCount < 1 || config.RetentionCount > 500 || config.RetentionDays < 1 || config.RetentionDays > 3650 {
		return errors.New("sync retention is outside the supported range")
	}
	return validateSyncProviderEndpoints(config)
}

func validateSyncProviderEndpoints(config model.SyncConfig) error {
	switch config.Provider {
	case model.SyncProviderS3:
		return validateS3Endpoint(config.S3.Endpoint)
	case model.SyncProviderWebDAV:
		return validateWebDAVEndpoint(config.WebDAV.URL)
	default:
		return nil
	}
}

func validateWebDAVEndpoint(endpoint string) error {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return nil
	}
	parsed, err := url.ParseRequestURI(endpoint)
	if err != nil {
		return errors.New("WebDAV URL is invalid")
	}
	return requireHTTPSUnlessLoopback(parsed)
}

func providerIdentity(config model.SyncConfig) string {
	switch config.Provider {
	case model.SyncProviderGist:
		return config.Gist.GistID
	case model.SyncProviderWebDAV:
		return config.WebDAV.URL + "\x00" + config.WebDAV.Username
	case model.SyncProviderS3:
		return strings.Join([]string{config.S3.Endpoint, config.S3.Region, config.S3.Bucket, config.S3.Prefix, config.S3.AccessKeyID, fmt.Sprint(config.S3.PathStyle)}, "\x00")
	default:
		return ""
	}
}

func (s *SyncService) saveGistID(config model.SyncConfig, gistID string) error {
	gistID = strings.TrimSpace(gistID)
	if gistID == "" {
		return errors.New("GitHub Gist ID is required")
	}
	s.configMu.Lock()
	defer s.configMu.Unlock()
	current, err := s.loadConfig()
	if err != nil {
		return err
	}
	if current.Provider != model.SyncProviderGist || current.Gist.GistID != config.Gist.GistID {
		return errors.New("sync configuration changed while creating GitHub Gist")
	}
	current.Gist.GistID = gistID
	return writeSyncSetting(s.db, syncConfigSetting, current)
}

type syncSecretChanges struct {
	settings []model.Setting
	deletes  []string
}

func (s *SyncService) prepareInputSecrets(input model.SyncConfigInput) (syncSecretChanges, error) {
	updates := []struct {
		key, value string
		clear      bool
	}{
		{syncGistTokenSetting, input.Gist.Token, input.Gist.ClearToken},
		{syncWebDAVPasswordSetting, input.WebDAV.Password, input.WebDAV.ClearPassword},
		{syncS3SecretSetting, input.S3.SecretKey, input.S3.ClearSecretKey},
	}
	changes := syncSecretChanges{}
	for _, update := range updates {
		if update.clear {
			changes.deletes = append(changes.deletes, update.key)
			continue
		}
		if update.value != "" {
			setting, err := s.encryptedSecretSetting(update.key, update.value)
			if err != nil {
				return syncSecretChanges{}, err
			}
			changes.settings = append(changes.settings, setting)
		}
	}
	return changes, nil
}

func (s *SyncService) saveSecret(key, value string) error {
	return withCryptoOperation(s.crypto, func() error {
		setting, err := s.encryptedSecretSetting(key, value)
		if err != nil {
			return err
		}
		return store.SetSettings(s.db, []model.Setting{setting})
	})
}

func (s *SyncService) encryptedSecretSetting(key, value string) (model.Setting, error) {
	if s.crypto == nil {
		return model.Setting{}, errors.New("sync credential encryption is unavailable")
	}
	plaintext := []byte(value)
	defer clear(plaintext)
	encrypted, err := s.crypto.Encrypt(plaintext)
	if err != nil {
		return model.Setting{}, fmt.Errorf("encrypt sync credential: %w", err)
	}
	return buildSyncSetting(key, string(encrypted))
}

func (s *SyncService) loadSecret(key string) (string, error) {
	var plaintext string
	err := withCryptoOperation(s.crypto, func() error {
		var err error
		plaintext, err = s.loadSecretUnlocked(key)
		return err
	})
	return plaintext, err
}

func (s *SyncService) loadSecretUnlocked(key string) (string, error) {
	var encrypted string
	if err := readSyncSetting(s.db, key, &encrypted); err != nil {
		return "", err
	}
	if s.crypto == nil {
		return "", errors.New("sync credential decryption is unavailable")
	}
	decrypted, err := s.crypto.Decrypt([]byte(encrypted))
	if err != nil {
		return "", fmt.Errorf("decrypt sync credential: %w", err)
	}
	defer clear(decrypted)
	return string(decrypted), nil
}
