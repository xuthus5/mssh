package service

import (
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"mssh/internal/model"
	"mssh/internal/ssh"
	"mssh/internal/store"
)

type LogService struct {
	db        *sql.DB
	mu        sync.Mutex
	recorders map[string]*ssh.Recorder
	dataDir   string
	logger    *slog.Logger
}

func NewLogService(db *sql.DB, dataDir string, logger *slog.Logger) *LogService {
	return &LogService{
		db:        db,
		recorders: make(map[string]*ssh.Recorder),
		dataDir:   dataDir,
		logger:    logger,
	}
}

func (l *LogService) List(sessionID *int64) ([]model.SessionLog, error) {
	if sessionID == nil {
		return store.ListSessionLogs(l.db)
	}
	return store.ListSessionLogsBySession(l.db, *sessionID)
}

func (l *LogService) StartRecording(sessionID int64, cols, rows int, termType, dataPath string) (int64, error) {
	l.logger.Info("starting recording", "sessionID", sessionID, "cols", cols, "rows", rows, "dataPath", dataPath)
	if dataPath == "" && l.dataDir != "" {
		recDir := filepath.Join(l.dataDir, "recordings")
		if err := os.MkdirAll(recDir, 0o700); err != nil {
			return 0, fmt.Errorf("start recording: create recordings dir: %w", err)
		}
		dataPath = filepath.Join(recDir, fmt.Sprintf("rec-%d-%d.msshlog", sessionID, time.Now().UnixNano()))
	}
	recorder, err := ssh.NewRecorder(dataPath, cols, rows, termType)
	if err != nil {
		return 0, fmt.Errorf("start recording: %w", err)
	}

	logEntry := model.SessionLog{
		SessionID: &sessionID,
		DataPath:  dataPath,
	}
	created, err := store.CreateSessionLog(l.db, logEntry)
	if err != nil {
		_ = recorder.Close()
		_ = os.Remove(dataPath)
		return 0, fmt.Errorf("start recording: %w", err)
	}

	l.mu.Lock()
	l.recorders[fmt.Sprintf("log-%d", created.ID)] = recorder
	l.mu.Unlock()

	return created.ID, nil
}

func (l *LogService) StopRecording(logID int64) error {
	l.logger.Info("stopping recording", "logID", logID)
	l.mu.Lock()
	recorder, ok := l.recorders[fmt.Sprintf("log-%d", logID)]
	if ok {
		delete(l.recorders, fmt.Sprintf("log-%d", logID))
	}
	l.mu.Unlock()

	if !ok {
		return fmt.Errorf("recording %d not active", logID)
	}

	return recorder.Close()
}

func (l *LogService) StartTerminalRecording(terminalID string, sessionID int64, cols, rows int, termType string) (int64, error) {
	l.logger.Info("starting terminal recording", "terminalID", terminalID, "sessionID", sessionID)
	recDir := filepath.Join(l.dataDir, "recordings")
	if err := os.MkdirAll(recDir, 0o700); err != nil {
		return 0, fmt.Errorf("start terminal recording: %w", err)
	}
	dataPath := filepath.Join(recDir, fmt.Sprintf("%s.msshlog", terminalID))
	recorder, err := ssh.NewRecorder(dataPath, cols, rows, termType)
	if err != nil {
		return 0, fmt.Errorf("start terminal recording: %w", err)
	}

	logEntry := model.SessionLog{
		SessionID: &sessionID,
		DataPath:  dataPath,
	}
	created, err := store.CreateSessionLog(l.db, logEntry)
	if err != nil {
		_ = recorder.Close()
		_ = os.Remove(dataPath)
		return 0, fmt.Errorf("start terminal recording: %w", err)
	}

	l.mu.Lock()
	l.recorders[terminalID] = recorder
	l.mu.Unlock()

	return created.ID, nil
}

func (l *LogService) StopTerminalRecording(terminalID string) error {
	l.logger.Info("stopping terminal recording", "terminalID", terminalID)
	l.mu.Lock()
	recorder, ok := l.recorders[terminalID]
	if ok {
		delete(l.recorders, terminalID)
	}
	l.mu.Unlock()

	if !ok {
		return fmt.Errorf("recording for terminal %s not active", terminalID)
	}

	return recorder.Close()
}

func (l *LogService) HandleOutput(terminalID string, data []byte) {
	l.mu.Lock()
	recorder, ok := l.recorders[terminalID]
	l.mu.Unlock()
	if !ok {
		return
	}
	_ = recorder.Write(data, model.RecordStdout)
}

func (l *LogService) GetRecording(path string) (*ssh.Player, error) {
	return ssh.NewPlayer(path)
}

func (l *LogService) Delete(id int64) error {
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
