package service

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
)

type LogService struct {
	db                   *sql.DB
	mu                   sync.Mutex
	recorders            map[string]*activeRecording
	finalizing           map[int64]struct{}
	starting             map[string]struct{}
	dataDir              string
	logger               *slog.Logger
	lifecycle            serviceOperationGate
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

const (
	sessionLogFinalizeAttempts   = 3
	sessionLogFinalizeRetryDelay = 10 * time.Millisecond
)

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
	if logger == nil {
		logger = slog.Default()
	}
	logService := &LogService{
		db:         db,
		recorders:  make(map[string]*activeRecording),
		finalizing: make(map[int64]struct{}),
		starting:   make(map[string]struct{}),
		dataDir:    dataDir,
		logger:     logger,
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
	logService.cleanupStagedRecordingFiles()
	logService.recoverIncompleteSessionLogs()
	return logService
}

func (l *LogService) recoverIncompleteSessionLogs() {
	if l.db == nil {
		return
	}
	recovered, err := store.EndIncompleteSessionLogs(l.db)
	if err != nil {
		l.logger.Error("recover incomplete session logs failed", "error", err)
		return
	}
	if recovered > 0 {
		l.logger.Warn("recovered incomplete session logs", "count", recovered)
	}
}

func (l *LogService) List(sessionID *int64) ([]model.SessionLog, error) {
	finish, err := l.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if sessionID == nil {
		return store.ListSessionLogs(l.db)
	}
	if *sessionID < 0 {
		return nil, fmt.Errorf("invalid session id")
	}
	return store.ListSessionLogsBySession(l.db, *sessionID)
}

func (l *LogService) StartTerminalRecording(terminalID string, sessionID int64, cols, rows int, termType string) (int64, error) {
	finish, err := l.beginOperation()
	if err != nil {
		return 0, err
	}
	defer finish()
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
	dataPath := filepath.Join(recDir, "recording-"+uuid.NewString()+".msshlog")
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
