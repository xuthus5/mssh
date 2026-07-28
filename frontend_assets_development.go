//go:build !production

package main

import (
	"embed"
	"io/fs"
)

//go:embed frontend/index.html
var frontendSource embed.FS

func frontendAssets() fs.FS {
	sub, err := fs.Sub(frontendSource, "frontend")
	if err != nil {
		return frontendSource
	}
	return sub
}
