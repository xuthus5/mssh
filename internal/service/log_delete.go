package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/fsutil"
	"github.com/xuthus5/mssh/internal/store"
)

func (l *LogService) Delete(id int64) error {
	finish, err := l.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if id <= 0 {
		return errors.New("invalid log id")
	}
	if l.recordingInUse(id) {
		return fmt.Errorf("delete: recording is in use")
	}
	if l.logger != nil {
		l.logger.Info("deleting log", "id", id)
	}
	log, err := store.GetSessionLog(l.db, id)
	if err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	staged, err := l.stageRecordingDeletion(log.DataPath)
	if err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	if err := store.DeleteSessionLog(l.db, id); err != nil {
		return errors.Join(fmt.Errorf("delete: %w", err), staged.rollback())
	}
	if err := staged.remove(l.removeFile); err != nil && l.logger != nil {
		l.logger.Warn("remove staged recording failed", "logID", id, "path", staged.stagedPath, "error", err)
	}
	return nil
}

func (l *LogService) recordingInUse(logID int64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.finalizing[logID]; ok {
		return true
	}
	for _, recording := range l.recorders {
		if recording.logID == logID {
			return true
		}
	}
	return false
}

func (l *LogService) stageRecordingDeletion(path string) (stagedRecordingFile, error) {
	if path == "" {
		return stagedRecordingFile{}, nil
	}
	absPath, err := l.validRecordingDeletionPath(path)
	if err != nil {
		return stagedRecordingFile{}, err
	}
	return stageRecordingFile(absPath)
}

func (l *LogService) validRecordingDeletionPath(path string) (string, error) {
	if strings.TrimSpace(l.dataDir) == "" {
		return "", errors.New("recordings directory is unavailable")
	}
	cleaned, err := validateLocalFilePath(path)
	if err != nil {
		return "", err
	}
	recordingsDir, err := filepath.Abs(filepath.Join(l.dataDir, "recordings"))
	if err != nil {
		return "", fmt.Errorf("resolve recordings directory: %w", err)
	}
	absPath, err := filepath.Abs(cleaned)
	if err != nil {
		return "", fmt.Errorf("resolve recording path: %w", err)
	}
	if !pathWithinDirectory(recordingsDir, absPath) {
		return "", errors.New("path outside recordings directory")
	}
	_, resolvedDir, err := l.recordingDirectoryPaths()
	if err != nil {
		return "", err
	}
	resolvedParent, err := filepath.EvalSymlinks(filepath.Dir(absPath))
	if err != nil {
		return "", fmt.Errorf("resolve recording parent: %w", err)
	}
	if !pathWithinDirectory(resolvedDir, resolvedParent) {
		return "", errors.New("path outside recordings directory")
	}
	info, statErr := os.Lstat(absPath)
	if statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		resolvedPath, resolveErr := filepath.EvalSymlinks(absPath)
		if resolveErr != nil {
			return "", fmt.Errorf("resolve recording path: %w", resolveErr)
		}
		if !pathWithinDirectory(resolvedDir, resolvedPath) {
			return "", errors.New("path outside recordings directory")
		}
	}
	return absPath, nil
}

func (l *LogService) recordingDirectoryPaths() (string, string, error) {
	if strings.TrimSpace(l.dataDir) == "" {
		return "", "", errors.New("recordings directory is unavailable")
	}
	dataDir, err := filepath.Abs(l.dataDir)
	if err != nil {
		return "", "", fmt.Errorf("resolve data directory: %w", err)
	}
	recordingsDir := filepath.Join(dataDir, "recordings")
	info, err := os.Lstat(recordingsDir)
	if err != nil {
		return "", "", fmt.Errorf("inspect recordings directory: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", "", errors.New("recordings directory is not a regular directory")
	}
	resolvedDataDir, err := filepath.EvalSymlinks(dataDir)
	if err != nil {
		return "", "", fmt.Errorf("resolve data directory: %w", err)
	}
	resolvedDir, err := filepath.EvalSymlinks(recordingsDir)
	if err != nil {
		return "", "", fmt.Errorf("resolve recordings directory: %w", err)
	}
	if !pathWithinDirectory(resolvedDataDir, resolvedDir) {
		return "", "", errors.New("recordings directory is outside data directory")
	}
	return recordingsDir, resolvedDir, nil
}

type stagedRecordingFile struct {
	originalPath string
	stagedPath   string
	exists       bool
}

func stageRecordingFile(path string) (stagedRecordingFile, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return stagedRecordingFile{originalPath: path}, nil
	}
	if err != nil {
		return stagedRecordingFile{}, fmt.Errorf("inspect recording file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return stagedRecordingFile{}, errors.New("recording path is not a regular file")
	}
	staged := stagedRecordingFile{originalPath: path, stagedPath: path + ".deleting-" + uuid.NewString(), exists: true}
	if err := fsutil.ReplaceFile(staged.originalPath, staged.stagedPath); err != nil {
		stageErr := fmt.Errorf("stage recording deletion: %w", err)
		if _, statErr := os.Lstat(staged.stagedPath); statErr == nil {
			return stagedRecordingFile{}, errors.Join(stageErr, staged.rollback())
		}
		return stagedRecordingFile{}, stageErr
	}
	stagedInfo, err := os.Lstat(staged.stagedPath)
	if err == nil && stagedInfo.Mode().IsRegular() && os.SameFile(info, stagedInfo) {
		return staged, nil
	}
	validationErr := errors.New("recording path changed while staging deletion")
	if err != nil {
		validationErr = fmt.Errorf("inspect staged recording: %w", err)
	}
	return stagedRecordingFile{}, errors.Join(validationErr, staged.rollback())
}

func (s stagedRecordingFile) rollback() error {
	if !s.exists {
		return nil
	}
	if err := fsutil.ReplaceFile(s.stagedPath, s.originalPath); err != nil {
		return fmt.Errorf("restore recording file: %w", err)
	}
	return nil
}

func (s stagedRecordingFile) remove(removeFile func(string) error) error {
	if !s.exists {
		return nil
	}
	if removeFile == nil {
		return errors.New("recording file remover is unavailable")
	}
	if err := removeFile(s.stagedPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("delete staged recording file: %w", err)
	}
	return nil
}

func (l *LogService) cleanupStagedRecordingFiles() {
	if strings.TrimSpace(l.dataDir) == "" || l.db == nil || l.removeFile == nil {
		return
	}
	recordingsDir, _, err := l.recordingDirectoryPaths()
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil {
		l.warnRecordingCleanup("validate recordings directory", "", err)
		return
	}
	pattern := filepath.Join(recordingsDir, "*.deleting-*")
	paths, err := filepath.Glob(pattern)
	if err != nil {
		l.warnRecordingCleanup("find staged recordings", "", err)
		return
	}
	for _, path := range paths {
		l.cleanupStagedRecordingFile(path)
	}
}

func (l *LogService) cleanupStagedRecordingFile(path string) {
	info, err := os.Lstat(path)
	if err != nil {
		l.warnRecordingCleanup("inspect staged recording", path, err)
		return
	}
	if !info.Mode().IsRegular() {
		l.warnRecordingCleanup("inspect staged recording", path, errors.New("staged recording is not a regular file"))
		return
	}
	originalPath, ok := originalRecordingPath(path)
	if !ok {
		l.warnRecordingCleanup("parse staged recording", path, errors.New("invalid staged recording name"))
		return
	}
	referenced, err := l.recordingPathReferenced(originalPath)
	if err != nil {
		l.warnRecordingCleanup("check staged recording reference", path, err)
		return
	}
	if referenced {
		l.restoreStagedRecording(path, originalPath)
		return
	}
	if err := l.removeFile(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		l.warnRecordingCleanup("remove staged recording", path, err)
	}
}

func originalRecordingPath(stagedPath string) (string, bool) {
	marker := ".deleting-"
	index := strings.LastIndex(stagedPath, marker)
	return stagedPath[:max(index, 0)], index > 0 && index+len(marker) < len(stagedPath)
}

func (l *LogService) recordingPathReferenced(path string) (bool, error) {
	var referenced bool
	if err := l.db.QueryRow("SELECT EXISTS(SELECT 1 FROM session_logs WHERE data_path = ?)", path).Scan(&referenced); err != nil {
		return false, fmt.Errorf("query recording reference: %w", err)
	}
	return referenced, nil
}

func (l *LogService) restoreStagedRecording(stagedPath, originalPath string) {
	if _, err := os.Lstat(originalPath); err == nil {
		l.warnRecordingCleanup("restore staged recording", stagedPath, errors.New("original recording already exists"))
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		l.warnRecordingCleanup("inspect original recording", originalPath, err)
		return
	}
	if err := fsutil.ReplaceFile(stagedPath, originalPath); err != nil {
		l.warnRecordingCleanup("restore staged recording", stagedPath, err)
	}
}

func (l *LogService) warnRecordingCleanup(operation, path string, err error) {
	if l.logger != nil {
		l.logger.Warn(operation+" failed", "path", path, "error", err)
	}
}
