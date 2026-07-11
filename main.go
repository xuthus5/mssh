package main

import (
	"log/slog"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/xuthus5/mssh/internal/app"
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

	wailsApp := application.New(application.Options{
		Name:        "mssh",
		Description: "A cross-platform SSH client",
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
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	mainWindow := wailsApp.Window.NewWithOptions(mainWindowOptions())
	mainWindow.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		wailsApp.Event.Emit("sftp:files-dropped", map[string]any{
			"files":   event.Context().DroppedFiles(),
			"details": event.Context().DropTargetDetails(),
		})
	})

	wailsApp.OnShutdown(func() {
		appInstance.Shutdown()
	})

	logger.Info("MSSH started")
	if err := wailsApp.Run(); err != nil {
		logger.Error("MSSH run failed", "error", err)
		os.Exit(1)
	}
}

func mainWindowOptions() application.WebviewWindowOptions {
	return application.WebviewWindowOptions{
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
