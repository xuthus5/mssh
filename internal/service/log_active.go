package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
)

func (l *LogService) StopTerminalRecording(terminalID string) error {
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	l.logger.Info("stopping terminal recording", "terminalID", terminalID)
	recording, ok := l.takeRecording(terminalID)
	if !ok {
		return fmt.Errorf("recording for terminal %s not active", terminalID)
	}
	err := l.finishRecording("stop terminal recording", recording)
	l.addShutdownError(err)
	l.finalizers.Done()
	return err
}

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
	l.finalizers.Done()
	return err
}

func (l *LogService) takeRecording(terminalID string) (*activeRecording, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.shuttingDown {
		return nil, false
	}
	recording, ok := l.recorders[terminalID]
	if ok {
		delete(l.recorders, terminalID)
		l.finalizers.Add(1)
	}
	return recording, ok
}

func (l *LogService) finishRecording(operation string, recording *activeRecording) error {
	closeErr := recording.close()
	if closeErr != nil {
		closeErr = fmt.Errorf("%s: close recorder: %w", operation, closeErr)
	}
	endErr := l.endSessionLog(l.db, recording.logID)
	if endErr != nil {
		endErr = fmt.Errorf("%s: %w", operation, endErr)
	}
	return errors.Join(closeErr, endErr)
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
	rel, err := filepath.Rel(recordingsDir, absPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("get recording: path outside recordings directory")
	}
	return nil
}

func (l *LogService) Delete(id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid log id")
	}
	l.logger.Info("deleting log", "id", id)
	log, err := store.GetSessionLog(l.db, id)
	if err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	if err := store.DeleteSessionLog(l.db, id); err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	if log.DataPath != "" {
		_ = os.Remove(log.DataPath)
	}
	return nil
}
