//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package ssh

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func openUploadSource(path string) (*os.File, os.FileInfo, error) {
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return nil, nil, fmt.Errorf("resolve local upload source: %w", err)
	}
	fd, err := unix.Open(resolvedPath, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("open local upload source: %w", err)
	}
	file := os.NewFile(uintptr(fd), resolvedPath) // #nosec G115 -- unix.Open returns a non-negative native descriptor.
	if file == nil {
		_ = unix.Close(fd)
		return nil, nil, fmt.Errorf("open local upload source: invalid file descriptor")
	}
	opened, info, err := inspectUploadSource(file)
	if err != nil {
		return nil, nil, err
	}
	if err := unix.SetNonblock(fd, false); err != nil {
		return nil, nil, closeRejectedLocalFile(opened, fmt.Errorf("restore blocking upload source: %w", err))
	}
	return opened, info, nil
}
