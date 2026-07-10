package service

import (
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"sync"

	"mssh/internal/model"
	"mssh/internal/ssh"
	"mssh/internal/store"
)

type LogService struct {
	db        *sql.DB
	mu        sync.Mutex
	recorders map[string]*ssh.Recorder
	logger    *slog.Logger
}

func NewLogService(db *sql.DB, logger *slog.Logger) *LogService {
	return &LogService{
		db:        db,
		recorders: make(map[string]*ssh.Recorder),
		logger:    logger,
	}
}

func (l *LogService) List(sessionID *int64) ([]model.SessionLog, error) {
	logs, err := store.ListSessionLogs(l.db)
	if err != nil {
		return nil, err
	}
	if sessionID == nil {
		return logs, nil
	}
	var filtered []model.SessionLog
	for _, log := range logs {
		if log.SessionID != nil && *log.SessionID == *sessionID {
			filtered = append(filtered, log)
		}
	}
	if filtered == nil {
		filtered = []model.SessionLog{}
	}
	return filtered, nil
}

func (l *LogService) StartRecording(sessionID int64, cols, rows int, termType, dataPath string) (int64, error) {
	l.logger.Info("starting recording", "sessionID", sessionID, "cols", cols, "rows", rows, "dataPath", dataPath)
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

func (l *LogService) GetRecording(path string) (*ssh.Player, error) {
	return ssh.NewPlayer(path)
}

func (l *LogService) Delete(id int64) error {
	l.logger.Info("deleting log", "id", id)
	logs, err := store.ListSessionLogs(l.db)
	if err != nil {
		return fmt.Errorf("delete: %w", err)
	}

	var dataPath string
	for _, log := range logs {
		if log.ID == id {
			dataPath = log.DataPath
			break
		}
	}

	if err := store.DeleteSessionLog(l.db, id); err != nil {
		return fmt.Errorf("delete: %w", err)
	}

	if dataPath != "" {
		_ = os.Remove(dataPath)
	}

	return nil
}
