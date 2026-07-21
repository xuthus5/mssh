package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"slices"
	"strings"

	"github.com/google/uuid"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
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

func WithVaultInstaller(installer func(password string, vault backupcrypto.VaultFile) error) SyncOption {
	return func(service *SyncService) { service.vaultInstaller = installer }
}

func WithSyncCrypto(crypto KeyCrypto) SyncOption {
	return func(service *SyncService) { service.crypto = crypto }
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
	config := configFromInput(input)
	if err := validateSyncConfig(config); err != nil {
		return model.SyncDashboard{}, err
	}
	previous, err := s.LoadConfig()
	if err != nil {
		return model.SyncDashboard{}, err
	}
	if err := s.saveInputSecrets(input); err != nil {
		return model.SyncDashboard{}, err
	}
	if err := writeSyncSetting(s.db, syncConfigSetting, config); err != nil {
		return model.SyncDashboard{}, err
	}
	if previous.Provider != config.Provider || providerIdentity(previous) != providerIdentity(config) {
		if err := store.DeleteSetting(s.db, syncBaselineSetting(config.Provider)); err != nil {
			return model.SyncDashboard{}, err
		}
	}
	s.restartScheduler()
	return s.Dashboard()
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
	return nil
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
	config.Gist.GistID = gistID
	return writeSyncSetting(s.db, syncConfigSetting, config)
}

func (s *SyncService) saveInputSecrets(input model.SyncConfigInput) error {
	updates := []struct {
		key, value string
		clear      bool
	}{
		{syncGistTokenSetting, input.Gist.Token, input.Gist.ClearToken},
		{syncWebDAVPasswordSetting, input.WebDAV.Password, input.WebDAV.ClearPassword},
		{syncS3SecretSetting, input.S3.SecretKey, input.S3.ClearSecretKey},
	}
	for _, update := range updates {
		if update.clear {
			if err := store.DeleteSetting(s.db, update.key); err != nil {
				return err
			}
			continue
		}
		if update.value != "" {
			if err := s.saveSecret(update.key, update.value); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *SyncService) saveSecret(key, value string) error {
	if s.crypto == nil {
		return errors.New("sync credential encryption is unavailable")
	}
	encrypted, err := s.crypto.Encrypt([]byte(value))
	if err != nil {
		return fmt.Errorf("encrypt sync credential: %w", err)
	}
	return writeSyncSetting(s.db, key, string(encrypted))
}

func (s *SyncService) loadSecret(key string) (string, error) {
	var encrypted string
	if err := readSyncSetting(s.db, key, &encrypted); err != nil {
		return "", err
	}
	if s.crypto == nil {
		return "", errors.New("sync credential decryption is unavailable")
	}
	plaintext, err := s.crypto.Decrypt([]byte(encrypted))
	if err != nil {
		return "", fmt.Errorf("decrypt sync credential: %w", err)
	}
	return string(plaintext), nil
}

func (s *SyncService) secretSaved(key string) bool {
	var raw string
	return s.db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&raw) == nil && raw != ""
}

func (s *SyncService) deviceID() (string, error) {
	var value string
	if err := readSyncSetting(s.db, syncDeviceIDSetting, &value); err == nil && value != "" {
		return value, nil
	}
	value = uuid.NewString()
	if err := writeSyncSetting(s.db, syncDeviceIDSetting, value); err != nil {
		return "", err
	}
	return value, nil
}

func writeSyncSetting(db *sql.DB, key string, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode sync setting %s: %w", key, err)
	}
	setting := model.Setting{Key: key, Namespace: "sync", Value: string(encoded), ValueType: syncSettingType(value), Version: 1}
	return store.SetSettings(db, []model.Setting{setting})
}

func readSyncSetting(db *sql.DB, key string, value any) error {
	setting, err := store.GetSettingEntry(db, key)
	if err != nil {
		return err
	}
	if setting == nil {
		return sql.ErrNoRows
	}
	if err := json.Unmarshal([]byte(setting.Value), value); err != nil {
		return fmt.Errorf("decode sync setting %s: %w", key, err)
	}
	return nil
}

func syncSettingType(value any) string {
	switch value.(type) {
	case string:
		return "string"
	case bool:
		return "boolean"
	case int, int64:
		return "number"
	default:
		return "object"
	}
}

func syncVersionPath(dataDir, fileName string) string {
	return filepath.Join(dataDir, "sync", "versions", fileName)
}

func syncHTTPClient() *http.Client {
	return &http.Client{Timeout: syncNetworkTimeout}
}
