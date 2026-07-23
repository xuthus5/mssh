package app

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"sync"

	"github.com/xuthus5/mssh/internal/applog"
	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

type App struct {
	DB       *sql.DB
	Keychain crypto.KeychainAdapter

	Session        *service.SessionService
	Terminal       *service.TerminalService
	File           *service.FileService
	Tunnel         *service.TunnelService
	Key            *service.KeyService
	Macro          *service.MacroService
	CommandHistory *service.CommandHistoryService
	Theme          *service.ThemeService
	Log            *service.LogService
	Sync           *service.SyncService
	Setting        *service.SettingService
	About          *service.AboutService
	Font           *service.FontService
	Audit          *service.AuditService
	AssetCatalog   *service.AssetCatalogService
	AI             *service.AIService
	Security       *service.SecurityService
	Serial         *service.SerialService
	logger         *slog.Logger
	shutdownOnce   sync.Once
}

type Options struct {
	DataDir      string
	Logger       *slog.Logger
	LogManager   *applog.Manager
	ProxyManager *netproxy.Manager
}

func New(opts Options) (*App, error) {
	return newApp(opts, store.OpenDB)
}

func newApp(opts Options, openDB func(string) (*sql.DB, error)) (*App, error) {
	return newAppWithDependencies(opts, defaultAppDependencies(openDB))
}

type serviceInitialization struct {
	db       *sql.DB
	keychain crypto.KeychainAdapter
	opts     Options
	eventBus service.EventBus
	logger   *slog.Logger
}

type appDependencies struct {
	openDB             func(string) (*sql.DB, error)
	initializeSchema   func(*sql.DB) error
	initializeServices func(serviceInitialization) (*App, error)
	closeDB            func(*sql.DB) error
	keychain           crypto.KeychainAdapter
}

func defaultAppDependencies(openDB func(string) (*sql.DB, error)) appDependencies {
	return appDependencies{
		openDB:             openDB,
		initializeSchema:   store.InitializeSchema,
		initializeServices: initializeServices,
		closeDB:            func(db *sql.DB) error { return db.Close() },
		keychain:           crypto.NewKeychainAdapter(),
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

	eventBus := event.NewWailsEventBus(logger)
	logger.Info("initializing services")
	appInstance, err = dependencies.initializeServices(serviceInitialization{
		db: db, keychain: dependencies.keychain,
		opts: opts, eventBus: eventBus, logger: logger,
	})
	if err != nil {
		return nil, err
	}
	if appInstance.Sync != nil {
		appInstance.Sync.StartScheduler()
	}
	applyStartupSettings(appInstance, logger)
	cleanup = false
	return appInstance, nil
}

func applyStartupSettings(appInstance *App, logger *slog.Logger) {
	if appInstance == nil || appInstance.Setting == nil {
		return
	}
	if err := appInstance.Setting.ApplyStoredLogSettings(); err != nil {
		logger.Warn("apply stored log settings failed", "error", err)
	}
	if err := appInstance.Setting.ApplyStoredProxySettings(); err != nil {
		logger.Warn("apply stored proxy settings failed", "error", err)
	}
	if appInstance.Security == nil {
		return
	}
	settingSvc := appInstance.Setting
	syncSvc := appInstance.Sync
	appInstance.Security.SetAfterUnlock(func() {
		if err := settingSvc.ApplyStoredProxySettings(); err != nil {
			logger.Warn("apply proxy settings after unlock failed", "error", err)
		}
		if syncSvc != nil {
			// Catch up after vault unlock (covers manual unlock and late auto-unlock races).
			syncSvc.NotifyVaultUnlocked()
		}
	})
	// If vault already unlocked during service init (auto-unlock), trigger catch-up once.
	if syncSvc != nil && appInstance.Security != nil {
		if status, err := appInstance.Security.Status(); err == nil && status.Unlocked {
			syncSvc.NotifyVaultUnlocked()
		}
	}
}

func initializeServices(input serviceInitialization) (*App, error) {
	runtime := service.NewCryptoRuntime()
	securitySvc := newSecurityService(input, runtime)
	sessionSvc := service.NewSessionService(input.db, input.eventBus, service.DefaultKeepAliveSeconds, input.opts.DataDir, runtime, input.logger)
	sessionSvc.SetPasswordVerifier(securitySvc)
	terminalSvc := service.NewTerminalService(sessionSvc, input.eventBus, 32, input.logger)
	serialSvc := service.NewSerialService(input.db, input.logger)
	terminalSvc.SetSerialService(serialSvc)
	tunnelSvc := service.NewTunnelService(input.db, sessionSvc, input.eventBus, input.logger)
	sessionSvc.SetTunnelStopper(tunnelSvc)
	logSvc := service.NewLogService(input.db, input.opts.DataDir, input.logger)
	themeSvc, err := newThemeService(input)
	if err != nil {
		return nil, err
	}
	configureTerminalLogging(terminalSvc, logSvc, input.logger)
	syncSvc := newSyncService(input, runtime, securitySvc, terminalSvc, tunnelSvc, sessionSvc)
	return assembleApp(input, runtime, securitySvc, sessionSvc, terminalSvc, serialSvc, tunnelSvc, logSvc, themeSvc, syncSvc), nil
}

func newSecurityService(input serviceInitialization, runtime *service.CryptoRuntime) *service.SecurityService {
	securitySvc := service.NewSecurityService(input.db, input.opts.DataDir, runtime, input.keychain, input.logger)
	securitySvc.SetEventBus(input.eventBus)
	if err := securitySvc.TryAutoUnlock(); err != nil {
		input.logger.Warn("auto unlock vault failed", "error", err)
	}
	return securitySvc
}

func newThemeService(input serviceInitialization) (*service.ThemeService, error) {
	themeSvc := service.NewThemeService(input.db, input.logger)
	if err := themeSvc.InitializeDefaults(); err != nil {
		return nil, fmt.Errorf("initialize terminal themes: %w", err)
	}
	return themeSvc, nil
}

func newSyncService(input serviceInitialization, runtime *service.CryptoRuntime, securitySvc *service.SecurityService, terminalSvc *service.TerminalService, tunnelSvc *service.TunnelService, sessionSvc *service.SessionService) *service.SyncService {
	return service.NewSyncService(input.db, input.logger,
		service.WithSyncDataDir(input.opts.DataDir),
		service.WithSyncCrypto(runtime),
		service.WithSyncSecretSource(securitySvc.SyncSecret),
		service.WithVaultSource(func() (*crypto.VaultFile, error) {
			vault, err := securitySvc.ExportVaultFile()
			if err != nil {
				return nil, err
			}
			return &vault, nil
		}),
		service.WithVaultInstaller(securitySvc.InstallVaultFromExport),
		service.WithSyncEventBus(input.eventBus),
		service.WithSyncLifecycle(syncLifecycleAdapter{terminal: terminalSvc, tunnel: tunnelSvc, session: sessionSvc}),
		service.WithSyncProxy(input.opts.ProxyManager))
}

func newSettingService(input serviceInitialization, runtime *service.CryptoRuntime) *service.SettingService {
	return service.NewSettingService(input.db, input.logger, service.SettingServiceOptions{
		Log:    input.opts.LogManager,
		Proxy:  input.opts.ProxyManager,
		Crypto: runtime,
	})
}

func assembleApp(input serviceInitialization, runtime *service.CryptoRuntime, securitySvc *service.SecurityService, sessionSvc *service.SessionService, terminalSvc *service.TerminalService, serialSvc *service.SerialService, tunnelSvc *service.TunnelService, logSvc *service.LogService, themeSvc *service.ThemeService, syncSvc *service.SyncService) *App {
	return &App{
		DB:             input.db,
		Keychain:       input.keychain,
		Session:        sessionSvc,
		Terminal:       terminalSvc,
		File:           service.NewFileService(sessionSvc, input.eventBus, input.logger, service.WithTransferDB(input.db)),
		Tunnel:         tunnelSvc,
		Key:            service.NewKeyService(input.db, runtime, input.logger),
		Macro:          service.NewMacroService(input.db, terminalSvc, input.logger),
		CommandHistory: service.NewCommandHistoryService(input.db, input.logger),
		Theme:          themeSvc,
		Log:            logSvc,
		Sync:           syncSvc,
		Setting:        newSettingService(input, runtime),
		About:          service.NewAboutService(input.opts.ProxyManager),
		Font:           service.NewFontService(input.logger),
		Audit:          service.NewAuditService(input.db, input.logger),
		AssetCatalog:   service.NewAssetCatalogService(input.db, input.logger),
		AI:             service.NewAIService(input.db, terminalSvc, input.keychain, input.logger, input.opts.ProxyManager),
		Security:       securitySvc,
		Serial:         serialSvc,
		logger:         input.logger,
	}
}
