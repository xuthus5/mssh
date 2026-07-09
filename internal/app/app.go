package app

import (
	"database/sql"
	"fmt"

	"mssh/internal/crypto"
	"mssh/internal/service"
	"mssh/internal/store"
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
}

type Options struct {
	DataDir string
}

type nopEventBus struct{}

func (n *nopEventBus) Emit(_ string, _ interface{}) {}

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

	db, err := store.OpenDB(opts.DataDir)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := store.Migrate(db); err != nil {
		return nil, fmt.Errorf("migrate database: %w", err)
	}

	masterKey, err := crypto.GenerateRandomBytes(32)
	if err != nil {
		return nil, fmt.Errorf("generate master key: %w", err)
	}

	keychain := crypto.NewKeychainAdapter()
	_ = keychain

	eventBus := &nopEventBus{}

	sessionSvc := service.NewSessionService(db, eventBus, 30)
	terminalSvc := service.NewTerminalService(sessionSvc, eventBus, 32)
	fileSvc := service.NewFileService(sessionSvc, eventBus)
	tunnelSvc := service.NewTunnelService(db, sessionSvc, eventBus)

	cryptoAdapter := &cryptoAdapter{key: masterKey}
	keySvc := service.NewKeyService(db, cryptoAdapter)

	macroSvc := service.NewMacroService(db, terminalSvc)
	themeSvc := service.NewThemeService(db)
	logSvc := service.NewLogService(db)
	syncSvc := service.NewSyncService(db)

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
	}, nil
}
