package crypto

import (
	"errors"
	"fmt"
	"io"

	"github.com/xuthus5/mssh/internal/fsutil"
)

const maxVaultFileBytes = 64 * 1024

func readVaultPayload(path string) ([]byte, error) {
	file, info, err := fsutil.OpenRegularFile(path)
	if err != nil {
		return nil, fmt.Errorf("open vault: %w", err)
	}
	if info.Size() > maxVaultFileBytes {
		closeErr := file.Close()
		return nil, errors.Join(fmt.Errorf("vault file exceeds %d bytes", maxVaultFileBytes), closeErr)
	}
	return readVaultData(file)
}

func readVaultData(file io.ReadCloser) ([]byte, error) {
	payload, readErr := io.ReadAll(io.LimitReader(file, maxVaultFileBytes+1))
	closeErr := file.Close()
	if err := errors.Join(readErr, closeErr); err != nil {
		return nil, fmt.Errorf("read vault: %w", err)
	}
	if len(payload) > maxVaultFileBytes {
		return nil, fmt.Errorf("vault file exceeds %d bytes", maxVaultFileBytes)
	}
	return payload, nil
}
