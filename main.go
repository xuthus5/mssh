package main

import (
	"log"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"

	"mssh/internal/app"
)

func main() {
	appInstance, err := app.New(app.Options{
		DataDir: defaultDataDir(),
	})
	if err != nil {
		log.Fatal(err)
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
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(os.DirFS("./frontend/dist")),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "MSSH",
		Width:  1280,
		Height: 800,
	})

	if err := wailsApp.Run(); err != nil {
		log.Fatal(err)
	}
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".mssh"
	}
	return home + "/.mssh"
}
