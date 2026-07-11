package app

import (
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

type App struct {
	DB       *sql.DB
	Crypto   []byte
	Keychain crypto.KeychainAdapter

	Session  *service.SessionService
	Terminal *service.TerminalService
	File     *service.FileService
	Tunnel   *service.TunnelService
	Key      *service.KeyService
	Macro    *service.MacroService
	Theme    *service.ThemeService
	Log      *service.LogService
	Sync     *service.SyncService
	Setting  *service.SettingService
	About    *service.AboutService
}

type Options struct {
	DataDir string
	Logger  *slog.Logger
}

type cryptoAdapter struct {
	key []byte
}

func (c *cryptoAdapter) Encrypt(plaintext []byte) ([]byte, error) {
	return crypto.Encrypt(plaintext, c.key)
}

func (c *cryptoAdapter) Decrypt(ciphertext []byte) ([]byte, error) {
	return crypto.Decrypt(ciphertext, c.key)
}

const masterKeyFile = "master.key"

func loadMasterKey(dataDir string, keychain crypto.KeychainAdapter, logger *slog.Logger) ([]byte, error) {
	if keychain.IsAvailable() {
		key, err := keychain.Get("mssh", "master-key")
		if err == nil && len(key) == 32 {
			logger.Info("master key loaded from keychain")
			return key, nil
		}
		if err != nil {
			logger.Warn("keychain get failed", "error", err)
		}
	}

	keyPath := filepath.Join(dataDir, masterKeyFile)
	data, err := os.ReadFile(keyPath)
	if err == nil && len(data) == 32 {
		logger.Info("master key loaded from file")
		return data, nil
	}

	return nil, nil
}

func persistMasterKey(dataDir string, key []byte, keychain crypto.KeychainAdapter, logger *slog.Logger) {
	if keychain.IsAvailable() {
		if err := keychain.Set("mssh", "master-key", key); err != nil {
			logger.Warn("keychain set failed", "error", err)
		} else {
			logger.Info("master key persisted to keychain")
		}
	}

	keyPath := filepath.Join(dataDir, masterKeyFile)
	if err := os.WriteFile(keyPath, key, 0o600); err != nil {
		logger.Warn("write master key file failed", "error", err)
	} else {
		logger.Info("master key persisted to file")
	}
}

func New(opts Options) (*App, error) {
	if opts.DataDir == "" {
		return nil, fmt.Errorf("data directory is required")
	}

	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}

	logger.Info("opening database")
	db, err := store.OpenDB(opts.DataDir)
	if err != nil {
		logger.Error("open database failed", "error", err)
		return nil, fmt.Errorf("open database: %w", err)
	}

	logger.Info("running migrations")
	if err := store.Migrate(db); err != nil {
		logger.Error("migrate database failed", "error", err)
		return nil, fmt.Errorf("migrate database: %w", err)
	}

	keychain := crypto.NewKeychainAdapter()

	logger.Info("loading master key")
	masterKey, err := loadMasterKey(opts.DataDir, keychain, logger)
	if err != nil {
		logger.Error("load master key failed", "error", err)
		return nil, fmt.Errorf("load master key: %w", err)
	}

	if masterKey == nil {
		logger.Info("generating new master key")
		masterKey, err = crypto.GenerateRandomBytes(32)
		if err != nil {
			logger.Error("generate master key failed", "error", err)
			return nil, fmt.Errorf("generate master key: %w", err)
		}
		persistMasterKey(opts.DataDir, masterKey, keychain, logger)
	}

	eventBus := event.NewWailsEventBus(logger)

	logger.Info("initializing services")
	cryptoAdapter := &cryptoAdapter{key: masterKey}
	sessionSvc := service.NewSessionService(db, eventBus, 30, opts.DataDir, cryptoAdapter, logger)
	terminalSvc := service.NewTerminalService(sessionSvc, eventBus, 32, logger)
	fileSvc := service.NewFileService(sessionSvc, eventBus, logger)
	tunnelSvc := service.NewTunnelService(db, sessionSvc, eventBus, logger)

	keySvc := service.NewKeyService(db, cryptoAdapter, logger)

	macroSvc := service.NewMacroService(db, terminalSvc, logger)
	themeSvc := service.NewThemeService(db, logger)
	logSvc := service.NewLogService(db, opts.DataDir, logger)
	syncSvc := service.NewSyncService(db, logger)

	terminalSvc.SetOutputHandler(func(terminalID string, data []byte) {
		logSvc.HandleOutput(terminalID, data)
	})
	terminalSvc.SetCloseHandler(func(terminalID string) {
		_ = logSvc.StopTerminalRecordingIfActive(terminalID)
	})

	return &App{
		DB:       db,
		Crypto:   masterKey,
		Keychain: keychain,
		Session:  sessionSvc,
		Terminal: terminalSvc,
		File:     fileSvc,
		Tunnel:   tunnelSvc,
		Key:      keySvc,
		Macro:    macroSvc,
		Theme:    themeSvc,
		Log:      logSvc,
		Sync:     syncSvc,
		Setting:  service.NewSettingService(db, logger),
		About:    service.NewAboutService(),
	}, nil
}

func (a *App) Shutdown() {
	if a.DB != nil {
		_ = a.DB.Close()
	}
}

func DefaultTestLogger(t interface{ Logf(string, ...any) }) *slog.Logger {
	return slog.New(slog.NewTextHandler(&testLogWriter{t}, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

type testLogWriter struct {
	t interface{ Logf(string, ...any) }
}

func (w *testLogWriter) Write(p []byte) (int, error) {
	w.t.Logf("%s", p)
	return len(p), nil
}
