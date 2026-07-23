package service

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
)

type LogService struct {
	db                   *sql.DB
	mu                   sync.Mutex
	recorders            map[string]*activeRecording
	starting             map[string]struct{}
	dataDir              string
	logger               *slog.Logger
	shuttingDown         bool
	shutdownOnce         sync.Once
	shutdownErr          error
	shutdownErrors       []error
	starters, finalizers sync.WaitGroup
	newRecorder          func(string, int, int, string) (terminalRecorder, error)
	createSessionLog     func(*sql.DB, model.SessionLog) (*model.SessionLog, error)
	endSessionLog        func(*sql.DB, int64) error
	removeFile           func(string) error
}

type LogServiceOption func(*LogService)

// WithSessionLogFinalizer overrides session-log finalization for alternate storage wiring.
func WithSessionLogFinalizer(finalizer func(*sql.DB, int64) error) LogServiceOption {
	return func(logService *LogService) {
		if finalizer != nil {
			logService.endSessionLog = finalizer
		}
	}
}

type terminalRecorder interface {
	Write(data []byte, recordType model.RecordType) error
	Close() error
}

type activeRecording struct {
	mu       sync.Mutex
	recorder terminalRecorder
	logID    int64
}

func (recording *activeRecording) write(data []byte) error {
	recording.mu.Lock()
	defer recording.mu.Unlock()
	return recording.recorder.Write(data, model.RecordStdout)
}

func (recording *activeRecording) close() error {
	recording.mu.Lock()
	defer recording.mu.Unlock()
	return recording.recorder.Close()
}

func NewLogService(db *sql.DB, dataDir string, logger *slog.Logger, options ...LogServiceOption) *LogService {
	logService := &LogService{
		db:        db,
		recorders: make(map[string]*activeRecording),
		starting:  make(map[string]struct{}),
		dataDir:   dataDir,
		logger:    logger,
		newRecorder: func(path string, cols, rows int, termType string) (terminalRecorder, error) {
			return ssh.NewRecorder(path, cols, rows, termType)
		},
		createSessionLog: store.CreateSessionLog,
		endSessionLog:    store.EndSessionLog,
		removeFile:       os.Remove,
	}
	for _, option := range options {
		option(logService)
	}
	return logService
}

func (l *LogService) List(sessionID *int64) ([]model.SessionLog, error) {
	if sessionID == nil {
		return store.ListSessionLogs(l.db)
	}
	if *sessionID < 0 {
		return nil, fmt.Errorf("invalid session id")
	}
	return store.ListSessionLogsBySession(l.db, *sessionID)
}

func (l *LogService) StartTerminalRecording(terminalID string, sessionID int64, cols, rows int, termType string) (int64, error) {
	if err := validateTerminalID(terminalID); err != nil {
		return 0, err
	}
	if sessionID < 0 {
		return 0, fmt.Errorf("invalid session id")
	}
	l.logger.Info("starting terminal recording", "terminalID", terminalID, "sessionID", sessionID)
	l.mu.Lock()
	if l.shuttingDown {
		l.mu.Unlock()
		return 0, fmt.Errorf("start terminal recording: service is shutting down")
	}
	_, active := l.recorders[terminalID]
	_, starting := l.starting[terminalID]
	if active || starting {
		l.mu.Unlock()
		return 0, fmt.Errorf("start terminal recording: terminal %s already recording", terminalID)
	}
	l.starting[terminalID] = struct{}{}
	l.starters.Add(1)
	l.mu.Unlock()
	defer l.finishRecordingStart(terminalID)

	recording, err := l.createActiveRecording(sessionID, [2]int{cols, rows}, termType)
	if err != nil {
		return 0, err
	}
	l.mu.Lock()
	if !l.shuttingDown {
		l.recorders[terminalID] = recording
		l.mu.Unlock()
		return recording.logID, nil
	}
	l.mu.Unlock()
	shutdownErr := fmt.Errorf("start terminal recording: service is shutting down")
	finalizeErr := l.finishRecording("start terminal recording during shutdown", recording)
	l.addShutdownError(finalizeErr)
	return 0, errors.Join(shutdownErr, finalizeErr)
}

func (l *LogService) createActiveRecording(sessionID int64, size [2]int, termType string) (*activeRecording, error) {
	recDir := filepath.Join(l.dataDir, "recordings")
	if err := os.MkdirAll(recDir, 0o700); err != nil {
		return nil, fmt.Errorf("start terminal recording: %w", err)
	}
	tempFile, err := os.CreateTemp(recDir, "recording-*.msshlog")
	if err != nil {
		return nil, fmt.Errorf("start terminal recording: create recording file: %w", err)
	}
	dataPath := tempFile.Name()
	if err = tempFile.Close(); err != nil {
		closeErr := fmt.Errorf("start terminal recording: close recording file: %w", err)
		return nil, errors.Join(closeErr, l.removeRecordingFile(dataPath))
	}
	recorder, err := l.newRecorder(dataPath, size[0], size[1], termType)
	if err != nil {
		createErr := fmt.Errorf("start terminal recording: %w", err)
		return nil, errors.Join(createErr, l.removeRecordingFile(dataPath))
	}
	var sessionRef *int64
	if sessionID > 0 {
		sessionRef = &sessionID
	}
	logEntry := model.SessionLog{SessionID: sessionRef, DataPath: dataPath}
	created, err := l.createSessionLog(l.db, logEntry)
	if err != nil {
		createErr := fmt.Errorf("start terminal recording: %w", err)
		closeErr := recorder.Close()
		if closeErr != nil {
			closeErr = fmt.Errorf("start terminal recording: close recorder after failure: %w", closeErr)
		}
		return nil, errors.Join(createErr, closeErr, l.removeRecordingFile(dataPath))
	}
	return &activeRecording{recorder: recorder, logID: created.ID}, nil
}

func (l *LogService) finishRecordingStart(terminalID string) {
	l.mu.Lock()
	delete(l.starting, terminalID)
	l.mu.Unlock()
	l.starters.Done()
}

func (l *LogService) removeRecordingFile(path string) error {
	if err := l.removeFile(path); err != nil {
		return fmt.Errorf("start terminal recording: remove recording file: %w", err)
	}
	return nil
}

// CloseAllActiveRecordings permanently stops every active recording without exposing a Wails service method.
func CloseAllActiveRecordings(logService *LogService) error {
	if logService == nil {
		return nil
	}
	logService.shutdownOnce.Do(func() {
		logService.shutdownErr = logService.closeAllActiveRecordings()
	})
	return logService.shutdownErr
}

func (l *LogService) closeAllActiveRecordings() error {
	l.mu.Lock()
	l.shuttingDown = true
	recordings := l.recorders
	l.recorders = make(map[string]*activeRecording)
	l.mu.Unlock()
	errs := make([]error, 0, len(recordings))
	for terminalID, recording := range recordings {
		if err := l.finishRecording("close active terminal recording", recording); err != nil {
			errs = append(errs, fmt.Errorf("terminal %s: %w", terminalID, err))
		}
	}
	l.starters.Wait()
	l.finalizers.Wait()
	l.mu.Lock()
	errs = append(errs, l.shutdownErrors...)
	l.shutdownErrors = nil
	l.mu.Unlock()
	return errors.Join(errs...)
}

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
