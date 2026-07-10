package app

import (
	"database/sql"
	"fmt"
	"log/slog"

	"mssh/internal/crypto"
	"mssh/internal/service"
	"mssh/internal/store"
	"mssh/pkg/event"
)

type App struct {
	DB     *sql.DB
	Crypto []byte

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

	logger.Info("generating master key")
	masterKey, err := crypto.GenerateRandomBytes(32)
	if err != nil {
		logger.Error("generate master key failed", "error", err)
		return nil, fmt.Errorf("generate master key: %w", err)
	}

	keychain := crypto.NewKeychainAdapter()
	_ = keychain

	eventBus := event.NewWailsEventBus()

	logger.Info("initializing services")
	sessionSvc := service.NewSessionService(db, eventBus, 30, logger)
	terminalSvc := service.NewTerminalService(sessionSvc, eventBus, 32, logger)
	fileSvc := service.NewFileService(sessionSvc, eventBus, logger)
	tunnelSvc := service.NewTunnelService(db, sessionSvc, eventBus, logger)

	cryptoAdapter := &cryptoAdapter{key: masterKey}
	keySvc := service.NewKeyService(db, cryptoAdapter, logger)

	macroSvc := service.NewMacroService(db, terminalSvc, logger)
	themeSvc := service.NewThemeService(db, logger)
	logSvc := service.NewLogService(db, logger)
	syncSvc := service.NewSyncService(db, logger)
	settingSvc := service.NewSettingService(db, logger)

	return &App{
		DB:       db,
		Crypto:   masterKey,
		Session:  sessionSvc,
		Terminal: terminalSvc,
		File:     fileSvc,
		Tunnel:   tunnelSvc,
		Key:      keySvc,
		Macro:    macroSvc,
		Theme:    themeSvc,
		Log:      logSvc,
		Sync:     syncSvc,
		Setting:  settingSvc,
	}, nil
}
