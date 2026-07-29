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
	DB             *sql.DB
	Keychain       crypto.KeychainAdapter
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
	proxyManager   *netproxy.Manager
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
	openDB                      func(string) (*sql.DB, error)
	initializeSchema            func(*sql.DB) error
	recoverInterruptedTransfers func(*sql.DB) error
	initializeServices          func(serviceInitialization) (*App, error)
	closeDB                     func(*sql.DB) error
	keychain                    crypto.KeychainAdapter
}

func defaultAppDependencies(openDB func(string) (*sql.DB, error)) appDependencies {
	return appDependencies{
		openDB:                      openDB,
		initializeSchema:            store.InitializeSchema,
		recoverInterruptedTransfers: store.MarkInterruptedTransfers,
		initializeServices:          initializeServices,
		closeDB:                     func(db *sql.DB) error { return db.Close() },
		keychain:                    crypto.NewKeychainAdapter(),
	}
}

func newAppWithDependencies(opts Options, dependencies appDependencies) (*App, error) {
	if opts.DataDir == "" {
		return nil, fmt.Errorf("data directory is required")
	}
	opts.ProxyManager = defaultProxyManager(opts.ProxyManager)
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
	recoverInterruptedTransfers := dependencies.recoverInterruptedTransfers
	if recoverInterruptedTransfers == nil {
		recoverInterruptedTransfers = store.MarkInterruptedTransfers
	}
	if err = recoverInterruptedTransfers(db); err != nil {
		logger.Error("recover interrupted transfers failed", "error", err)
		return nil, fmt.Errorf("recover interrupted transfers: %w", err)
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
	applyStoredLogSettings(appInstance.Setting, logger)
	proxyApplyFailed := applyStoredProxySettings(appInstance.Setting, logger, "apply stored proxy settings failed")
	if appInstance.Security == nil {
		return
	}
	configureStartupSecurity(appInstance, logger, proxyApplyFailed)
}

func applyStoredLogSettings(settingSvc *service.SettingService, logger *slog.Logger) {
	if err := settingSvc.ApplyStoredLogSettings(); err != nil {
		logger.Warn("apply stored log settings failed", "error", err)
	}
}

func applyStoredProxySettings(settingSvc *service.SettingService, logger *slog.Logger, warning string) bool {
	if err := settingSvc.ApplyStoredProxySettings(); err != nil {
		logger.Warn(warning, "error", err)
		return true
	}
	return false
}

func configureStartupSecurity(appInstance *App, logger *slog.Logger, proxyApplyFailed bool) {
	settingSvc := appInstance.Setting
	syncSvc := appInstance.Sync
	appInstance.Security.SetAfterUnlock(func() {
		applyStoredProxySettings(settingSvc, logger, "apply proxy settings after unlock failed")
		notifyVaultUnlocked(syncSvc)
	})
	if status, err := appInstance.Security.Status(); err == nil && status.Unlocked {
		if proxyApplyFailed {
			applyStoredProxySettings(settingSvc, logger, "retry proxy settings after automatic unlock failed")
		}
		notifyVaultUnlocked(syncSvc)
	}
}

func notifyVaultUnlocked(syncSvc *service.SyncService) {
	if syncSvc != nil {
		// Catch up after vault unlock (covers manual unlock and late auto-unlock races).
		syncSvc.NotifyVaultUnlocked()
	}
}

func initializeServices(input serviceInitialization) (*App, error) {
	runtime := service.NewCryptoRuntime()
	themeSvc, err := newThemeService(input)
	if err != nil {
		return nil, err
	}
	securitySvc, err := newSecurityService(input, runtime)
	if err != nil {
		return nil, fmt.Errorf("recover security state: %w", err)
	}
	settingSvc := newSettingService(input, runtime)
	maxPoolSize := service.DefaultTerminalPoolSize
	if configured, loadErr := service.LoadTerminalPoolSize(input.db); loadErr != nil {
		input.logger.Warn("load terminal pool size failed; using default", "error", loadErr)
	} else {
		maxPoolSize = configured
	}
	sessionSvc := service.NewSessionService(input.db, input.eventBus, service.DefaultKeepAliveSeconds, input.opts.DataDir, runtime, input.logger)
	sessionSvc.SetPasswordVerifier(securitySvc)
	terminalSvc := service.NewTerminalService(sessionSvc, input.eventBus, maxPoolSize, input.logger)
	serialSvc := service.NewSerialService(input.db, input.logger)
	terminalSvc.SetSerialService(serialSvc)
	tunnelSvc := service.NewTunnelService(input.db, sessionSvc, input.eventBus, input.logger)
	sessionSvc.SetTunnelStopper(tunnelSvc)
	sessionSvc.SetTerminalCloser(terminalSvc)
	logSvc := service.NewLogService(input.db, input.opts.DataDir, input.logger)
	configureTerminalLogging(terminalSvc, logSvc, input.logger)
	fileSvc := service.NewFileService(sessionSvc, input.eventBus, input.logger,
		service.WithTransferDB(input.db), service.WithTransferJournalDataDir(input.opts.DataDir))
	sessionSvc.SetTransferCanceller(fileSvc)
	syncSvc := newSyncService(input, runtime, securitySvc, fileSvc, terminalSvc, tunnelSvc, sessionSvc, settingSvc)
	return assembleApp(input, runtime, securitySvc, sessionSvc, terminalSvc, fileSvc, serialSvc, tunnelSvc, logSvc, themeSvc, syncSvc, settingSvc), nil
}

func newSecurityService(input serviceInitialization, runtime *service.CryptoRuntime) (*service.SecurityService, error) {
	securitySvc := service.NewSecurityService(input.db, input.opts.DataDir, runtime, input.keychain, input.logger)
	if err := securitySvc.RecoverPendingRotation(); err != nil {
		return nil, err
	}
	securitySvc.SetEventBus(input.eventBus)
	if err := securitySvc.TryAutoUnlock(); err != nil {
		input.logger.Warn("auto unlock vault failed", "error", err)
	}
	return securitySvc, nil
}

func newThemeService(input serviceInitialization) (*service.ThemeService, error) {
	themeSvc := service.NewThemeService(input.db, input.logger)
	if err := themeSvc.InitializeDefaults(); err != nil {
		return nil, fmt.Errorf("initialize terminal themes: %w", err)
	}
	return themeSvc, nil
}

func newSyncService(input serviceInitialization, runtime *service.CryptoRuntime, securitySvc *service.SecurityService, fileSvc *service.FileService, terminalSvc *service.TerminalService, tunnelSvc *service.TunnelService, sessionSvc *service.SessionService, settingSvc *service.SettingService) *service.SyncService {
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
		service.WithVaultTransactionInstaller(securitySvc.PrepareVaultFromExport),
		service.WithSyncEventBus(input.eventBus),
		service.WithSyncLifecycle(syncLifecycleAdapter{file: fileSvc, terminal: terminalSvc, tunnel: tunnelSvc, session: sessionSvc}),
		service.WithSyncProxy(input.opts.ProxyManager),
		service.WithSyncRuntimeSettings(settingSvc))
}

func assembleApp(input serviceInitialization, runtime *service.CryptoRuntime, securitySvc *service.SecurityService, sessionSvc *service.SessionService, terminalSvc *service.TerminalService, fileSvc *service.FileService, serialSvc *service.SerialService, tunnelSvc *service.TunnelService, logSvc *service.LogService, themeSvc *service.ThemeService, syncSvc *service.SyncService, settingSvc *service.SettingService) *App {
	return &App{
		DB:             input.db,
		Keychain:       input.keychain,
		Session:        sessionSvc,
		Terminal:       terminalSvc,
		File:           fileSvc,
		Tunnel:         tunnelSvc,
		Key:            service.NewKeyService(input.db, runtime, input.logger),
		Macro:          service.NewMacroService(input.db, terminalSvc, input.logger),
		CommandHistory: service.NewCommandHistoryService(input.db, input.logger),
		Theme:          themeSvc,
		Log:            logSvc,
		Sync:           syncSvc,
		Setting:        settingSvc,
		About:          service.NewAboutService(input.opts.ProxyManager),
		Font:           service.NewFontService(input.logger),
		Audit:          service.NewAuditService(input.db, input.logger),
		AssetCatalog:   service.NewAssetCatalogService(input.db, input.logger),
		AI:             service.NewAIService(input.db, terminalSvc, input.keychain, input.logger, service.WithAIProxy(input.opts.ProxyManager), service.WithAIModelsDevDataDir(input.opts.DataDir)),
		Security:       securitySvc,
		Serial:         serialSvc,
		logger:         input.logger,
		proxyManager:   input.opts.ProxyManager,
	}
}
