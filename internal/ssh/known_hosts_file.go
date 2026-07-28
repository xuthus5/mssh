package ssh

import (
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/xuthus5/mssh/internal/fsutil"
)

const maxKnownHostsFileBytes int64 = 8 << 20

// ReadKnownHostsFile reads a regular known_hosts file within the supported size limit.
func ReadKnownHostsFile(path string) ([]byte, error) {
	file, err := openKnownHostsFile(path)
	if err != nil {
		return nil, err
	}
	content, readErr := io.ReadAll(io.LimitReader(file, maxKnownHostsFileBytes+1))
	closeErr := file.Close()
	if readErr != nil || closeErr != nil {
		return nil, fmt.Errorf("read known_hosts: %w", errors.Join(readErr, closeErr))
	}
	if int64(len(content)) > maxKnownHostsFileBytes {
		return nil, knownHostsTooLargeError()
	}
	return content, nil
}

func openKnownHostsFile(path string) (*os.File, error) {
	file, info, err := fsutil.OpenRegularFile(path)
	if err != nil {
		return nil, fmt.Errorf("open known_hosts: %w", err)
	}
	if info.Size() > maxKnownHostsFileBytes {
		return nil, closeKnownHostsWithError(file, knownHostsTooLargeError())
	}
	return file, nil
}

func closeKnownHostsWithError(file *os.File, err error) error {
	if closeErr := file.Close(); closeErr != nil {
		return errors.Join(err, fmt.Errorf("close known_hosts: %w", closeErr))
	}
	return err
}

func knownHostsTooLargeError() error {
	return fmt.Errorf("known_hosts exceeds %d bytes", maxKnownHostsFileBytes)
}
