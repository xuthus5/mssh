package service

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/ssh"
)

func (l *LogService) StopTerminalRecording(terminalID string) error {
	finish, err := l.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	l.logger.Info("stopping terminal recording", "terminalID", terminalID)
	recording, ok := l.takeRecording(terminalID)
	if !ok {
		return fmt.Errorf("recording for terminal %s not active", terminalID)
	}
	err = l.finishRecording("stop terminal recording", recording)
	l.addShutdownError(err)
	l.completeRecordingFinalizer(recording.logID)
	return err
}

//wails:ignore
func (l *LogService) StopTerminalRecordingIfActive(terminalID string) error {
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	recording, ok := l.takeRecording(terminalID)
	if !ok {
		return nil
	}
	err := l.finishRecording("stop terminal recording if active", recording)
	l.addShutdownError(err)
	l.completeRecordingFinalizer(recording.logID)
	return err
}

func (l *LogService) takeRecording(terminalID string) (*activeRecording, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	recording, ok := l.recorders[terminalID]
	if ok {
		delete(l.recorders, terminalID)
		l.finalizing[recording.logID] = struct{}{}
		l.finalizers.Add(1)
	}
	return recording, ok
}

func (l *LogService) completeRecordingFinalizer(logID int64) {
	l.mu.Lock()
	delete(l.finalizing, logID)
	l.mu.Unlock()
	l.finalizers.Done()
}

func (l *LogService) finishRecording(operation string, recording *activeRecording) error {
	closeErr := recording.close()
	if closeErr != nil {
		closeErr = fmt.Errorf("%s: close recorder: %w", operation, closeErr)
	}
	endErr := l.endSessionLogWithRetry(recording.logID)
	if endErr != nil {
		endErr = fmt.Errorf("%s: %w", operation, endErr)
	}
	return errors.Join(closeErr, endErr)
}

func (l *LogService) endSessionLogWithRetry(logID int64) error {
	var finalErr error
	for attempt := 0; attempt < sessionLogFinalizeAttempts; attempt++ {
		finalErr = l.endSessionLog(l.db, logID)
		if finalErr == nil || !isRetryableSessionLogFinalizeError(finalErr) {
			return finalErr
		}
		if attempt+1 < sessionLogFinalizeAttempts {
			time.Sleep(time.Duration(attempt+1) * sessionLogFinalizeRetryDelay)
		}
	}
	return finalErr
}

func isRetryableSessionLogFinalizeError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, driver.ErrBadConn) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "database is locked") ||
		strings.Contains(message, "database is busy") ||
		strings.Contains(message, "sqlite_busy") ||
		strings.Contains(message, "sqlite_locked")
}

func (l *LogService) addShutdownError(err error) {
	if err == nil {
		return
	}
	l.mu.Lock()
	if l.shuttingDown {
		l.shutdownErrors = append(l.shutdownErrors, err)
	}
	l.mu.Unlock()
}

//wails:ignore
func (l *LogService) HandleOutput(terminalID string, data []byte) {
	l.mu.Lock()
	recording, ok := l.recorders[terminalID]
	l.mu.Unlock()
	if !ok {
		return
	}
	if err := recording.write(data); err != nil {
		l.logger.Error("write terminal recording failed", "terminalID", terminalID, "logID", recording.logID, "error", err)
	}
}

func (l *LogService) GetRecording(path string) (*ssh.Player, error) {
	finish, err := l.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	cleaned, err := validateLocalFilePath(path)
	if err != nil {
		return nil, fmt.Errorf("get recording: %w", err)
	}
	if err := l.ensureRecordingPath(cleaned); err != nil {
		return nil, err
	}
	return ssh.NewPlayer(cleaned)
}

func (l *LogService) ensureRecordingPath(path string) error {
	recordingsDir, err := filepath.Abs(filepath.Join(l.dataDir, "recordings"))
	if err != nil {
		return fmt.Errorf("get recording: resolve recordings directory: %w", err)
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("get recording: resolve path: %w", err)
	}
	if !pathWithinDirectory(recordingsDir, absPath) {
		return fmt.Errorf("get recording: path outside recordings directory")
	}
	_, resolvedDir, err := l.recordingDirectoryPaths()
	if err != nil {
		return fmt.Errorf("get recording: %w", err)
	}
	resolvedPath, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		return fmt.Errorf("get recording: resolve path: %w", err)
	}
	if !pathWithinDirectory(resolvedDir, resolvedPath) {
		return fmt.Errorf("get recording: path outside recordings directory")
	}
	return nil
}

func pathWithinDirectory(directory, path string) bool {
	relative, err := filepath.Rel(directory, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
