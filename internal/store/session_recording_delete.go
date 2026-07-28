package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/fsutil"
)

// ErrRecordingCleanupDeferred means database deletion committed while staged file cleanup needs maintenance.
var ErrRecordingCleanupDeferred = errors.New("recording cleanup deferred")

type sessionDeleteRequest struct {
	ids           []int64
	recordingsDir string
	removeFile    func(string) error
}

type stagedSessionRecording struct {
	databasePath string
	originalPath string
	stagedPath   string
	exists       bool
}

func stageSessionRecordings(paths []string) ([]stagedSessionRecording, error) {
	staged := make([]stagedSessionRecording, 0, len(paths))
	for _, path := range paths {
		recording, err := stageSessionRecording(path)
		if err != nil {
			return nil, errors.Join(err, rollbackStagedSessionRecordings(staged))
		}
		staged = append(staged, recording)
	}
	return staged, nil
}

func stageSessionRecording(path string) (stagedSessionRecording, error) {
	absPath, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return stagedSessionRecording{}, fmt.Errorf("resolve recording path: %w", err)
	}
	info, err := os.Lstat(absPath)
	if errors.Is(err, os.ErrNotExist) {
		return stagedSessionRecording{databasePath: path, originalPath: absPath}, nil
	}
	if err != nil {
		return stagedSessionRecording{}, fmt.Errorf("inspect recording file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return stagedSessionRecording{}, errors.New("recording path is not a regular file")
	}
	recording := stagedSessionRecording{
		databasePath: path,
		originalPath: absPath,
		stagedPath:   absPath + ".deleting-" + uuid.NewString(),
		exists:       true,
	}
	if err := fsutil.ReplaceFile(recording.originalPath, recording.stagedPath); err != nil {
		stageErr := fmt.Errorf("stage recording deletion: %w", err)
		if _, statErr := os.Lstat(recording.stagedPath); statErr == nil {
			return stagedSessionRecording{}, errors.Join(stageErr, recording.rollback())
		}
		return stagedSessionRecording{}, stageErr
	}
	return validateStagedSessionRecording(recording, info)
}

func validateStagedSessionRecording(
	recording stagedSessionRecording,
	originalInfo os.FileInfo,
) (stagedSessionRecording, error) {
	stagedInfo, err := os.Lstat(recording.stagedPath)
	if err == nil && stagedInfo.Mode().IsRegular() && os.SameFile(originalInfo, stagedInfo) {
		return recording, nil
	}
	validationErr := errors.New("recording path changed while staging deletion")
	if err != nil {
		validationErr = fmt.Errorf("inspect staged recording: %w", err)
	}
	return stagedSessionRecording{}, errors.Join(validationErr, recording.rollback())
}

func rollbackStagedSessionRecordings(recordings []stagedSessionRecording) error {
	var rollbackErr error
	for index := len(recordings) - 1; index >= 0; index-- {
		rollbackErr = errors.Join(rollbackErr, recordings[index].rollback())
	}
	return rollbackErr
}

func reconcileStagedSessionRecordings(
	db *sql.DB,
	recordings []stagedSessionRecording,
	removeFile func(string) error,
) error {
	var cleanupErr error
	for _, recording := range recordings {
		if err := reconcileStagedSessionRecording(db, recording, removeFile); err != nil {
			cleanupErr = errors.Join(cleanupErr, err)
		}
	}
	return cleanupErr
}

func reconcileStagedSessionRecording(
	db *sql.DB,
	recording stagedSessionRecording,
	removeFile func(string) error,
) error {
	if !recording.exists {
		return nil
	}
	referenced, err := sessionRecordingPathReferenced(db, recording.databasePath)
	if err != nil {
		return err
	}
	if referenced {
		return recording.rollback()
	}
	return recording.remove(removeFile)
}

func sessionRecordingPathReferenced(db *sql.DB, path string) (bool, error) {
	var referenced bool
	query := "SELECT EXISTS(SELECT 1 FROM session_logs WHERE data_path = ?)"
	if err := db.QueryRow(query, path).Scan(&referenced); err != nil {
		return false, fmt.Errorf("check recording reference: %w", err)
	}
	return referenced, nil
}

func (recording stagedSessionRecording) rollback() error {
	if !recording.exists {
		return nil
	}
	if err := fsutil.ReplaceFile(recording.stagedPath, recording.originalPath); err != nil {
		return fmt.Errorf("restore recording file: %w", err)
	}
	return nil
}

func (recording stagedSessionRecording) remove(removeFile func(string) error) error {
	if !recording.exists {
		return nil
	}
	if removeFile == nil {
		return errors.New("recording file remover is unavailable")
	}
	if err := removeFile(recording.stagedPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove staged recording: %w", err)
	}
	return nil
}

func rollbackSessionDelete(tx *sql.Tx) error {
	if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
		return fmt.Errorf("delete sessions: rollback: %w", err)
	}
	return nil
}
