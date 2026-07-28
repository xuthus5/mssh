//go:build darwin

package fsutil

import (
	"os"
	"syscall"
)

func syncDirectoryFile(directory *os.File) error {
	return syscall.Fsync(int(directory.Fd()))
}
