package main

import (
	"context"
	_ "embed"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/xuthus5/mssh/internal/app"
	"github.com/xuthus5/mssh/internal/applog"
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/windowing"
)

//go:embed build/appicon.png
var appIcon []byte

const (
	windowCloseTimeout      = 2 * time.Second
	windowClosePollInterval = 10 * time.Millisecond
)

func main() {
	logLevel := slog.LevelInfo
	if os.Getenv("MSSH_LOG_LEVEL") == "debug" {
		logLevel = slog.LevelDebug
	}
	logManager := applog.New(applog.Options{Dir: applog.DefaultDir(), RetentionDays: applog.DefaultRetentionDays, Level: logLevel})
	if err := logManager.Configure(applog.DefaultDir(), applog.DefaultRetentionDays); err != nil {
		fmt.Fprintf(os.Stderr, "open application log failed: %v\n", err)
	}
	logger := slog.New(logManager.Handler())

	logger.Info("starting MSSH", "dataDir", defaultDataDir(), "logDir", logManager.Dir())
	proxyManager := netproxy.New()
	appInstance, err := app.New(app.Options{
		DataDir:      defaultDataDir(),
		Logger:       logger,
		LogManager:   logManager,
		ProxyManager: proxyManager,
	})
	if err != nil {
		logger.Error("startup failed", "error", err)
		shutdownRuntime(nil, logManager, os.Stderr)
		os.Exit(1)
	}

	debugEnabled := false
	if enabled, readErr := appInstance.Setting.ApplicationDebugEnabled(); readErr != nil {
		logger.Warn("read application debug setting failed", "error", readErr)
	} else {
		debugEnabled = enabled
	}
	gpuPolicy := application.WebviewGpuPolicyNever
	if stored, readErr := appInstance.Setting.WebviewGpu(); readErr != nil {
		logger.Warn("read webview gpu setting failed", "error", readErr)
	} else {
		gpuPolicy = resolveWebviewGpuPolicy(stored)
	}
	traceFrontend := logLevel == slog.LevelDebug
	wailsApp := newWailsApplication(appInstance, logger)
	if traceFrontend {
		_ = wailsApp.Event.On("terminal:trace", newFrontendTraceHandler(logger))
	}
	configureWindows(wailsApp, windowConfiguration{
		Settings:      appInstance.Setting,
		Logger:        logger,
		DebugEnabled:  debugEnabled,
		TraceFrontend: traceFrontend,
		GpuPolicy:     gpuPolicy,
	})
	wailsApp.OnShutdown(func() {
		shutdownRuntime(appInstance, logManager, os.Stderr)
	})

	logger.Info("MSSH started")
	runErr := wailsApp.Run()
	if runErr != nil {
		logger.Error("MSSH run failed", "error", runErr)
	}
	shutdownRuntime(appInstance, logManager, os.Stderr)
	if runErr != nil {
		os.Exit(1)
	}
}

type runtimeShutdowner interface {
	Shutdown()
}

type runtimeLogCloser interface {
	Close() error
}

func shutdownRuntime(application runtimeShutdowner, logCloser runtimeLogCloser, stderr io.Writer) {
	if application != nil {
		application.Shutdown()
	}
	if logCloser == nil {
		return
	}
	if err := logCloser.Close(); err != nil {
		if stderr == nil {
			stderr = os.Stderr
		}
		_, _ = fmt.Fprintf(stderr, "close application log failed: %v\n", err)
	}
}

func newWailsApplication(appInstance *app.App, logger *slog.Logger) *application.App {
	// The WebSocket IPC transport is experimental: wails beta's event bridge
	// (dispatchWailsEvent -> eventListeners) is unreliable for WebSocket
	// delivery in WebKitGTK, which breaks interactive flows like host key
	// confirmation. It also interferes with the default ExecJS event path, so
	// it stays opt-in. The default HTTP+ExecJS transport is fully functional.
	var transport application.Transport
	if os.Getenv("MSSH_ENABLE_WS_TRANSPORT") == "1" {
		transport = app.NewWailsWSTransport(logger)
	}
	wailsApp := application.New(application.Options{
		Name:        "mssh",
		Description: "A cross-platform SSH client",
		Icon:        appIcon,
		Logger:      newWailsSystemLogger(logger),
		Services: []application.Service{
			application.NewService(appInstance.Session),
			application.NewService(appInstance.Terminal),
			application.NewService(appInstance.File),
			application.NewService(appInstance.Tunnel),
			application.NewService(appInstance.Key),
			application.NewService(appInstance.Macro),
			application.NewService(appInstance.CommandHistory),
			application.NewService(appInstance.Theme),
			application.NewService(appInstance.Log),
			application.NewService(appInstance.Sync),
			application.NewService(appInstance.Setting),
			application.NewService(appInstance.About),
			application.NewService(appInstance.Font),
			application.NewService(appInstance.Audit),
			application.NewService(appInstance.AssetCatalog),
			application.NewService(appInstance.AI),
			application.NewService(appInstance.Security),
			application.NewService(appInstance.Serial),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(frontendAssets()),
		},
		Transport: transport,
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	})
	appInstance.Key.SetFilePicker(&wailsKeyFilePicker{app: wailsApp})
	return wailsApp
}

type wailsKeyFilePicker struct {
	app *application.App
}

func (p *wailsKeyFilePicker) SelectPrivateKey(directory string) (string, error) {
	if p.app == nil {
		return "", fmt.Errorf("wails application is not initialized")
	}
	dialog := p.app.Dialog.OpenFile().SetTitle("选择 SSH 私钥").SetDirectory(directory).
		ShowHiddenFiles(true).AllowsOtherFileTypes(true)
	if window, exists := p.app.Window.GetByName(windowing.SettingsWindowName); exists {
		dialog.AttachToWindow(window)
	}
	return dialog.PromptForSingleSelection()
}

type wailsSystemLogHandler struct {
	next slog.Handler
}

func newWailsSystemLogger(logger *slog.Logger) *slog.Logger {
	return slog.New(&wailsSystemLogHandler{next: logger.Handler()})
}

// newFrontendTraceHandler logs terminal trace events forwarded by the frontend.
func newFrontendTraceHandler(logger *slog.Logger) func(*application.CustomEvent) {
	return func(event *application.CustomEvent) {
		logger.Debug("frontend trace", "payload", event.Data)
	}
}

func (h *wailsSystemLogHandler) Enabled(ctx context.Context, level slog.Level) bool {
	if level < slog.LevelInfo {
		return false
	}
	return h.next.Enabled(ctx, level)
}

func (h *wailsSystemLogHandler) Handle(ctx context.Context, record slog.Record) error {
	if record.Level < slog.LevelInfo || record.Message == "Runtime call:" || record.Message == "Binding call complete:" {
		return nil
	}
	return h.next.Handle(ctx, record)
}

func (h *wailsSystemLogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &wailsSystemLogHandler{next: h.next.WithAttrs(attrs)}
}

func (h *wailsSystemLogHandler) WithGroup(name string) slog.Handler {
	return &wailsSystemLogHandler{next: h.next.WithGroup(name)}
}

type windowConfiguration struct {
	Settings     windowing.CloseActionReader
	Logger       *slog.Logger
	DebugEnabled bool
	// TraceFrontend enables forwarding of frontend terminal traces to the app log.
	TraceFrontend bool
	// GpuPolicy is the Linux webview hardware acceleration policy.
	GpuPolicy application.WebviewGpuPolicy
}

func configureWindows(wailsApp *application.App, configuration windowConfiguration) {
	mainWindow := wailsApp.Window.NewWithOptions(mainWindowOptions(configuration.GpuPolicy))
	if configuration.DebugEnabled {
		openMainWindowDevToolsOnFirstShow(mainWindow)
	}
	if configuration.TraceFrontend {
		_ = mainWindow.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
			mainWindow.ExecJS("window.__msshTrace = true")
		})
	}
	settingsController := windowing.NewSettingsWindowController(wailsApp.Window, mainWindow, wailsApp.Event.Emit)
	settingsController.Preload()
	lifecycleController := windowing.NewApplicationLifecycleController(windowing.ApplicationLifecycleOptions{
		Settings: configuration.Settings, Logger: configuration.Logger,
		ShowMain: func() { mainWindow.Show() }, HideMain: func() { mainWindow.Hide() },
		FocusMain: func() { mainWindow.Focus() }, HideSettings: settingsController.Hide,
		CloseSettings: settingsController.Close,
		Quit:          wailsApp.Quit,
	})
	_ = wailsApp.Event.On(windowing.OpenSettingsWindowEvent, func(*application.CustomEvent) {
		settingsController.Open()
	})
	_ = mainWindow.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		lifecycleController.HandleWindowClosing(event)
	})
	_ = mainWindow.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		_ = wailsApp.Event.Emit("sftp:files-dropped", map[string]any{
			"files":   event.Context().DroppedFiles(),
			"details": event.Context().DropTargetDetails(),
		})
	})
	configureSystemTray(wailsApp, lifecycleController)
}

// openMainWindowDevToolsOnFirstShow opens the WebView inspector once after the
// main window becomes visible, when the application debug setting is enabled.
func openMainWindowDevToolsOnFirstShow(window *application.WebviewWindow) {
	var once sync.Once
	_ = window.OnWindowEvent(events.Common.WindowShow, func(*application.WindowEvent) {
		once.Do(func() { window.OpenDevTools() })
	})
}

func configureSystemTray(wailsApp *application.App, controller *windowing.ApplicationLifecycleController) (*application.SystemTray, *application.Menu) {
	menu := wailsApp.NewMenu()
	menu.Add("显示主窗口").OnClick(func(*application.Context) { controller.ShowMainWindow() })
	menu.Add("隐藏到托盘").OnClick(func(*application.Context) { controller.HideMainWindow() })
	menu.AddSeparator()
	menu.Add("退出").OnClick(func(*application.Context) {
		controller.QuitApplicationAfter(func() { closeWindowsBeforeQuit(wailsApp) })
	})
	tray := wailsApp.SystemTray.New()
	tray.SetIcon(appIcon).SetMenu(menu).OnClick(controller.ShowMainWindow)
	tray.SetTooltip("MSSH")
	return tray, menu
}

func closeWindowsBeforeQuit(wailsApp *application.App) {
	for _, window := range wailsApp.Window.GetAll() {
		window.Close()
	}
	_ = waitForWindowsClosed(func() int { return len(wailsApp.Window.GetAll()) }, windowCloseTimeout, windowClosePollInterval)
}

func waitForWindowsClosed(count func() int, timeout, interval time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for count() > 0 {
		if !time.Now().Before(deadline) {
			return false
		}
		time.Sleep(interval)
	}
	return true
}

func mainWindowOptions(gpuPolicy application.WebviewGpuPolicy) application.WebviewWindowOptions {
	return application.WebviewWindowOptions{
		Name:           "main",
		Title:          "MSSH",
		Width:          1280,
		Height:         800,
		Frameless:      true,
		EnableFileDrop: true,
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: gpuPolicy,
		},
	}
}

// resolveWebviewGpuPolicy resolves the Linux webview GPU acceleration policy.
// The MSSH_WEBVIEW_GPU env override takes precedence, then the persisted setting
// ("always"), and otherwise GPU stays disabled (default, for dialog stability).
func resolveWebviewGpuPolicy(stored string) application.WebviewGpuPolicy {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("MSSH_WEBVIEW_GPU"))) {
	case "always", "on":
		return application.WebviewGpuPolicyAlways
	case "never", "off":
		return application.WebviewGpuPolicyNever
	}
	if stored == "always" {
		return application.WebviewGpuPolicyAlways
	}
	return application.WebviewGpuPolicyNever
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".mssh"
	}
	return filepath.Join(home, ".mssh")
}
