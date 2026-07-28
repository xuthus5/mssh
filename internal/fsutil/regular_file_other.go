//go:build !aix && !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !solaris && !windows

package fsutil

import "os"

func openRegularFilePath(path string) (*os.File, error) {
	// #nosec G304 -- the common layer verifies identity and regular-file type before returning the handle.
	return os.Open(path)
}

func openRegularFileAppendPath(path string, create bool, permission os.FileMode) (*os.File, error) {
	flags := os.O_WRONLY | os.O_APPEND
	if create {
		flags |= os.O_CREATE | os.O_EXCL
	}
	// #nosec G304 -- the common layer verifies identity and regular-file type before returning the handle.
	return os.OpenFile(path, flags, permission.Perm())
}

func restoreRegularFileBlocking(*os.File) error {
	return nil
}
