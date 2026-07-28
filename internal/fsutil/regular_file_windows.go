//go:build windows

package fsutil

import (
	"errors"
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func openRegularFilePath(path string) (*os.File, error) {
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(
		pathPointer,
		windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_OPEN_REPARSE_POINT,
		0,
	)
	if err != nil {
		return nil, err
	}
	return newWindowsFile(handle, path)
}

func openRegularFileAppendPath(path string, create bool, permission os.FileMode) (*os.File, error) {
	_ = permission
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	creationMode := uint32(windows.OPEN_EXISTING)
	if create {
		creationMode = windows.CREATE_NEW
	}
	handle, err := windows.CreateFile(
		pathPointer,
		windows.FILE_READ_ATTRIBUTES|windows.FILE_APPEND_DATA|windows.FILE_WRITE_ATTRIBUTES|windows.SYNCHRONIZE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		creationMode,
		windows.FILE_FLAG_OPEN_REPARSE_POINT,
		0,
	)
	if err != nil {
		return nil, err
	}
	return newWindowsFile(handle, path)
}

func newWindowsFile(handle windows.Handle, path string) (*os.File, error) {
	file := os.NewFile(uintptr(handle), path)
	if file != nil {
		return file, nil
	}
	cause := errors.New("invalid file handle")
	if closeErr := windows.CloseHandle(handle); closeErr != nil {
		return nil, errors.Join(cause, fmt.Errorf("close invalid file handle: %w", closeErr))
	}
	return nil, cause
}

func restoreRegularFileBlocking(*os.File) error {
	return nil
}
