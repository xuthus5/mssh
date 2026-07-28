//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package fsutil

import (
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

func openRegularFilePath(path string) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	return newUnixFile(fd, path)
}

func openRegularFileAppendPath(path string, create bool, permission os.FileMode) (*os.File, error) {
	flags := unix.O_WRONLY | unix.O_APPEND | unix.O_CLOEXEC | unix.O_NOFOLLOW | unix.O_NONBLOCK
	if create {
		flags |= unix.O_CREAT | unix.O_EXCL
	}
	fd, err := unix.Open(path, flags, uint32(permission.Perm()))
	if err != nil {
		return nil, err
	}
	return newUnixFile(fd, path)
}

func newUnixFile(fd int, path string) (*os.File, error) {
	file := os.NewFile(uintptr(fd), path) // #nosec G115 -- unix.Open returns a non-negative native descriptor.
	if file == nil {
		_ = unix.Close(fd)
		return nil, fmt.Errorf("invalid file descriptor")
	}
	return file, nil
}

func restoreRegularFileBlocking(file *os.File) error {
	descriptor := int(file.Fd()) // #nosec G115 -- os.File descriptors fit the platform int used by fcntl.
	return unix.SetNonblock(descriptor, false)
}
