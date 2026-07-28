//go:build production

package main

import (
	"embed"
	"io/fs"
)

//go:embed all:frontend/dist
var frontendDist embed.FS

func frontendAssets() fs.FS {
	sub, err := fs.Sub(frontendDist, "frontend/dist")
	if err != nil {
		return frontendDist
	}
	return sub
}
