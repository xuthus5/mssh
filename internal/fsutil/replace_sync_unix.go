//go:build !windows && !darwin

package fsutil

import "os"

func syncDirectoryFile(directory *os.File) error {
	return directory.Sync()
}
