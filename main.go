package main

import (
	"context"
	_ "embed"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/xuthus5/mssh/internal/app"
	"github.com/xuthus5/mssh/internal/windowing"
)

//go:embed build/appicon.png
var appIcon []byte

const (
	windowCloseTimeout      = 2 * time.Second
	windowClosePollInterval = 10 * time.Millisecond
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	logger.Info("starting MSSH", "dataDir", defaultDataDir())
	appInstance, err := app.New(app.Options{
		DataDir: defaultDataDir(),
		Logger:  logger,
	})
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}

	wailsApp := newWailsApplication(appInstance, logger)
	configureWindows(wailsApp, windowConfiguration{Settings: appInstance.Setting, Logger: logger})
	wailsApp.OnShutdown(func() { appInstance.Shutdown() })

	logger.Info("MSSH started")
	if err := wailsApp.Run(); err != nil {
		logger.Error("MSSH run failed", "error", err)
		os.Exit(1)
	}
}

func newWailsApplication(appInstance *app.App, logger *slog.Logger) *application.App {
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
			application.NewService(appInstance.Theme),
			application.NewService(appInstance.Log),
			application.NewService(appInstance.Sync),
			application.NewService(appInstance.Setting),
			application.NewService(appInstance.About),
			application.NewService(appInstance.Font),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(os.DirFS("./frontend/dist")),
		},
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
	Settings windowing.CloseActionReader
	Logger   *slog.Logger
}

func configureWindows(wailsApp *application.App, configuration windowConfiguration) {
	mainWindow := wailsApp.Window.NewWithOptions(mainWindowOptions())
	settingsController := windowing.NewSettingsWindowController(wailsApp.Window, mainWindow, wailsApp.Event.Emit)
	lifecycleController := windowing.NewApplicationLifecycleController(windowing.ApplicationLifecycleOptions{
		Settings: configuration.Settings, Logger: configuration.Logger,
		ShowMain: func() { mainWindow.Show() }, HideMain: func() { mainWindow.Hide() },
		FocusMain: func() { mainWindow.Focus() }, CloseSettings: settingsController.Close,
		Quit: wailsApp.Quit,
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

func mainWindowOptions() application.WebviewWindowOptions {
	return application.WebviewWindowOptions{
		Name:           "main",
		Title:          "MSSH",
		Width:          1280,
		Height:         800,
		Frameless:      true,
		EnableFileDrop: true,
		BackgroundType: application.BackgroundTypeTranslucent,
		BackgroundColour: application.RGBA{
			Alpha: 0,
		},
		Mac: application.MacWindow{
			Backdrop: application.MacBackdropTransparent,
		},
		Linux: application.LinuxWindow{
			WindowIsTranslucent: true,
			WebviewGpuPolicy:    application.WebviewGpuPolicyNever,
		},
	}
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".mssh"
	}
	return filepath.Join(home, ".mssh")
}
