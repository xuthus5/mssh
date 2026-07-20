package app

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"sync"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

type App struct {
	DB       *sql.DB
	Crypto   []byte
	Keychain crypto.KeychainAdapter

	Session          *service.SessionService
	Terminal         *service.TerminalService
	File             *service.FileService
	Tunnel           *service.TunnelService
	Key              *service.KeyService
	Macro            *service.MacroService
	CommandHistory   *service.CommandHistoryService
	Theme            *service.ThemeService
	Log              *service.LogService
	Sync             *service.SyncService
	Setting          *service.SettingService
	About            *service.AboutService
	Font             *service.FontService
	Audit            *service.AuditService
	AssetCatalog     *service.AssetCatalogService
	AI               *service.AIService
	WindowAppearance *service.WindowAppearanceService
	logger           *slog.Logger
	shutdownOnce     sync.Once
}

type Options struct {
	DataDir string
	Logger  *slog.Logger
}

func New(opts Options) (*App, error) {
	return newApp(opts, store.OpenDB)
}

func newApp(opts Options, openDB func(string) (*sql.DB, error)) (*App, error) {
	return newAppWithDependencies(opts, defaultAppDependencies(openDB))
}

type serviceInitialization struct {
	db        *sql.DB
	masterKey []byte
	keychain  crypto.KeychainAdapter
	opts      Options
	eventBus  service.EventBus
	logger    *slog.Logger
}

type appDependencies struct {
	openDB              func(string) (*sql.DB, error)
	initializeSchema    func(*sql.DB) error
	initializeMasterKey func(string, crypto.KeychainAdapter, *slog.Logger) ([]byte, error)
	initializeServices  func(serviceInitialization) (*App, error)
	closeDB             func(*sql.DB) error
	keychain            crypto.KeychainAdapter
}

func defaultAppDependencies(openDB func(string) (*sql.DB, error)) appDependencies {
	return appDependencies{
		openDB:              openDB,
		initializeSchema:    store.InitializeSchema,
		initializeMasterKey: initializeMasterKey,
		initializeServices:  initializeServices,
		closeDB:             func(db *sql.DB) error { return db.Close() },
		keychain:            crypto.NewKeychainAdapter(),
	}
}

func newAppWithDependencies(opts Options, dependencies appDependencies) (*App, error) {
	if opts.DataDir == "" {
		return nil, fmt.Errorf("data directory is required")
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return startApp(opts, logger, dependencies)
}

func startApp(opts Options, logger *slog.Logger, dependencies appDependencies) (appInstance *App, err error) {
	logger.Info("opening database")
	db, err := dependencies.openDB(opts.DataDir)
	if err != nil {
		logger.Error("open database failed", "error", err)
		return nil, fmt.Errorf("open database: %w", err)
	}
	cleanup := true
	defer func() {
		if !cleanup {
			return
		}
		if closeErr := dependencies.closeDB(db); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close database after startup failure: %w", closeErr))
		}
	}()

	logger.Info("initializing database schema")
	if err = dependencies.initializeSchema(db); err != nil {
		logger.Error("initialize database schema failed", "error", err)
		return nil, fmt.Errorf("initialize database schema: %w", err)
	}

	masterKey, err := dependencies.initializeMasterKey(opts.DataDir, dependencies.keychain, logger)
	if err != nil {
		return nil, err
	}

	eventBus := event.NewWailsEventBus(logger)
	logger.Info("initializing services")
	appInstance, err = dependencies.initializeServices(serviceInitialization{
		db: db, masterKey: masterKey, keychain: dependencies.keychain,
		opts: opts, eventBus: eventBus, logger: logger,
	})
	if err != nil {
		return nil, err
	}
	if appInstance.Sync != nil {
		appInstance.Sync.StartScheduler()
	}
	cleanup = false
	return appInstance, nil
}

func initializeMasterKey(dataDir string, keychain crypto.KeychainAdapter, logger *slog.Logger) ([]byte, error) {
	logger.Info("loading master key")
	masterKey, err := loadMasterKey(dataDir, keychain, logger)
	if err != nil {
		logger.Error("load master key failed", "error", err)
		return nil, fmt.Errorf("load master key: %w", err)
	}
	if masterKey != nil {
		return masterKey, nil
	}
	logger.Info("generating new master key")
	masterKey, err = crypto.GenerateRandomBytes(32)
	if err != nil {
		logger.Error("generate master key failed", "error", err)
		return nil, fmt.Errorf("generate master key: %w", err)
	}
	persistMasterKey(masterKeyPersistence{dataDir: dataDir, key: masterKey, keychain: keychain, logger: logger})
	return masterKey, nil
}

func initializeServices(input serviceInitialization) (*App, error) {
	adapter := &cryptoAdapter{key: input.masterKey}
	sessionSvc := service.NewSessionService(input.db, input.eventBus, service.DefaultKeepAliveSeconds, input.opts.DataDir, adapter, input.logger)
	terminalSvc := service.NewTerminalService(sessionSvc, input.eventBus, 32, input.logger)
	tunnelSvc := service.NewTunnelService(input.db, sessionSvc, input.eventBus, input.logger)
	logSvc := service.NewLogService(input.db, input.opts.DataDir, input.logger)
	themeSvc := service.NewThemeService(input.db, input.logger)
	if err := themeSvc.InitializeDefaults(); err != nil {
		return nil, fmt.Errorf("initialize terminal themes: %w", err)
	}
	configureTerminalLogging(terminalSvc, logSvc, input.logger)
	syncSvc := service.NewSyncService(input.db, input.logger,
		service.WithSyncDataDir(input.opts.DataDir), service.WithSyncCrypto(adapter), service.WithSyncEventBus(input.eventBus),
		service.WithSyncLifecycle(syncLifecycleAdapter{terminal: terminalSvc, tunnel: tunnelSvc, session: sessionSvc}))
	settingSvc := service.NewSettingService(input.db, input.logger)
	return &App{
		DB:               input.db,
		Crypto:           input.masterKey,
		Keychain:         input.keychain,
		Session:          sessionSvc,
		Terminal:         terminalSvc,
		File:             service.NewFileService(sessionSvc, input.eventBus, input.logger, service.WithTransferDB(input.db)),
		Tunnel:           tunnelSvc,
		Key:              service.NewKeyService(input.db, adapter, input.logger),
		Macro:            service.NewMacroService(input.db, terminalSvc, input.logger),
		CommandHistory:   service.NewCommandHistoryService(input.db, input.logger),
		Theme:            themeSvc,
		Log:              logSvc,
		Sync:             syncSvc,
		Setting:          settingSvc,
		WindowAppearance: service.NewWindowAppearanceService(settingSvc, input.logger),
		About:            service.NewAboutService(),
		Font:             service.NewFontService(input.logger),
		Audit:            service.NewAuditService(input.db, input.logger),
		AssetCatalog:     service.NewAssetCatalogService(input.db, input.logger),
		AI:               service.NewAIService(input.db, terminalSvc, input.keychain, input.logger),
		logger:           input.logger,
	}, nil
}

type terminalRecordingStopper interface {
	StopTerminalRecordingIfActive(terminalID string) error
}

type syncLifecycleAdapter struct {
	terminal *service.TerminalService
	tunnel   *service.TunnelService
	session  *service.SessionService
}

func (s syncLifecycleAdapter) PrepareDestructiveSync() error {
	if err := service.CloseAllTerminals(s.terminal); err != nil {
		return err
	}
	if s.tunnel != nil {
		s.tunnel.StopAll()
	}
	if s.session != nil {
		return s.session.CloseAll()
	}
	return nil
}

func configureTerminalLogging(terminalSvc *service.TerminalService, logSvc *service.LogService, logger *slog.Logger) {
	terminalSvc.SetOutputHandler(func(terminalID string, data []byte) { logSvc.HandleOutput(terminalID, data) })
	terminalSvc.SetCloseHandler(func(terminalID string) { handleTerminalRecordingClose(logSvc, logger, terminalID) })
}

func handleTerminalRecordingClose(stopper terminalRecordingStopper, logger *slog.Logger, terminalID string) {
	if err := stopper.StopTerminalRecordingIfActive(terminalID); err != nil {
		logger.Error("stop terminal recording on close failed", "terminalID", terminalID, "error", err)
	}
}

func (a *App) Shutdown() {
	a.shutdownOnce.Do(a.shutdown)
}

func (a *App) shutdown() {
	logger := a.logger
	if logger == nil {
		logger = slog.Default()
	}
	if err := service.CloseAllActiveRecordings(a.Log); err != nil {
		logger.Error("close active recordings during shutdown failed", "error", err)
	}
	if a.File != nil {
		a.File.CancelAll()
	}
	if a.Sync != nil {
		a.Sync.StopScheduler()
	}
	if a.Tunnel != nil {
		a.Tunnel.StopAll()
	}
	if a.Session != nil {
		if err := a.Session.CloseAll(); err != nil {
			logger.Error("close SSH connections during shutdown failed", "error", err)
		}
	}
	if a.DB != nil {
		if err := a.DB.Close(); err != nil {
			logger.Error("close database during shutdown failed", "error", err)
		}
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
