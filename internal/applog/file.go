package applog

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/xuthus5/mssh/internal/fsutil"
)

func openDailyLogFile(dir, day string) (*os.File, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create log directory: %w", err)
	}
	path := filepath.Join(dir, day+logFileSuffix)
	file, _, err := fsutil.OpenRegularFileForAppend(path)
	if errors.Is(err, os.ErrNotExist) {
		file, _, err = fsutil.CreateRegularFileForAppend(path, 0o600)
		if errors.Is(err, os.ErrExist) {
			file, _, err = fsutil.OpenRegularFileForAppend(path)
		}
	}
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		return nil, closeLogFileAfterFailure(file, fmt.Errorf("chmod log file: %w", err))
	}
	return file, nil
}

func closeLogFileAfterFailure(file *os.File, cause error) error {
	if err := file.Close(); err != nil {
		return errors.Join(cause, fmt.Errorf("close rejected log file: %w", err))
	}
	return cause
}
