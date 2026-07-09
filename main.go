package main

import (
	"log"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func main() {
	app := application.New(application.Options{
		Name:        "mssh",
		Description: "A cross-platform SSH client",
		Services:    []application.Service{
			// Phase 10-11 阶段逐步注入
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(os.DirFS("./frontend/dist")),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "MSSH",
		Width:  1280,
		Height: 800,
	})

	err := app.Run()
	if err != nil {
		log.Fatal(err)
	}
}
