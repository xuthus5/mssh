package service

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	ssh "mssh/internal/ssh"
	"mssh/pkg/event"
)

type TerminalService struct {
	mu         sync.RWMutex
	ptys       map[string]*ssh.PTYSession
	eventBus   EventBus
	maxSize    int
	lastUsed   map[string]time.Time
	sessionSvc *SessionService
	logger     *slog.Logger
}

var _openPTY = ssh.OpenPTY

func NewTerminalService(sessionSvc *SessionService, eventBus EventBus, maxSize int, logger *slog.Logger) *TerminalService {
	if maxSize <= 0 {
		maxSize = 32
	}
	return &TerminalService{
		ptys:       make(map[string]*ssh.PTYSession),
		eventBus:   eventBus,
		maxSize:    maxSize,
		lastUsed:   make(map[string]time.Time),
		sessionSvc: sessionSvc,
		logger:     logger,
	}
}

func (t *TerminalService) Open(ctx context.Context, sessionID int64, cols, rows int) (string, error) {
	t.logger.Info("opening terminal", "sessionID", sessionID, "cols", cols, "rows", rows)
	connID, err := t.sessionSvc.Connect(ctx, sessionID)
	if err != nil {
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	wrapper, err := t.sessionSvc.GetClientWrapper(connID)
	if err != nil {
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	sess, err := t.sessionSvc.GetSession(sessionID)
	if err != nil {
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	termType := sess.TermType
	if termType == "" {
		termType = "xterm-256color"
	}

	pty, err := _openPTY(wrapper, termType, cols, rows)
	if err != nil {
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	terminalID := uuid.New().String()

	pty.SetReadCallback(func(data []byte) {
		t.eventBus.Emit(event.TerminalOutput, event.TerminalOutputPayload{
			TerminalID: terminalID,
			Data:       data,
		})
	})

	t.mu.Lock()
	if len(t.ptys) >= t.maxSize {
		t.evictLRU()
	}
	t.ptys[terminalID] = pty
	t.lastUsed[terminalID] = time.Now()
	t.mu.Unlock()

	t.logger.Info("terminal opened", "terminalID", terminalID)
	return terminalID, nil
}

func (t *TerminalService) Write(terminalID string, data []byte) (int, error) {
	t.logger.Debug("writing to terminal", "terminalID", terminalID, "len", len(data))
	t.mu.RLock()
	pty, ok := t.ptys[terminalID]
	t.mu.RUnlock()
	if !ok {
		return 0, fmt.Errorf("terminal %s not found", terminalID)
	}

	t.mu.Lock()
	t.lastUsed[terminalID] = time.Now()
	t.mu.Unlock()

	return pty.Write(data)
}

func (t *TerminalService) Resize(terminalID string, cols, rows int) error {
	t.logger.Info("resizing terminal", "terminalID", terminalID, "cols", cols, "rows", rows)
	t.mu.RLock()
	pty, ok := t.ptys[terminalID]
	t.mu.RUnlock()
	if !ok {
		return fmt.Errorf("terminal %s not found", terminalID)
	}

	t.mu.Lock()
	t.lastUsed[terminalID] = time.Now()
	t.mu.Unlock()

	return pty.Resize(cols, rows)
}

func (t *TerminalService) Close(terminalID string) error {
	t.logger.Info("closing terminal", "terminalID", terminalID)
	t.mu.Lock()
	pty, ok := t.ptys[terminalID]
	if !ok {
		t.mu.Unlock()
		t.logger.Error("close terminal failed", "terminalID", terminalID, "error", "terminal not found")
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	delete(t.ptys, terminalID)
	delete(t.lastUsed, terminalID)
	t.mu.Unlock()

	_ = pty.Close()

	_ = t.sessionSvc.Disconnect(terminalID)

	t.eventBus.Emit(event.TerminalClosed, event.ConnectionStatePayload{
		TerminalID: terminalID,
		State:      "closed",
	})

	t.logger.Info("terminal closed", "terminalID", terminalID)
	return nil
}

func (t *TerminalService) Count() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.ptys)
}

func (t *TerminalService) evictLRU() {
	var oldestID string
	var oldestTime time.Time
	first := true

	for id, ts := range t.lastUsed {
		if first || ts.Before(oldestTime) {
			oldestID = id
			oldestTime = ts
			first = false
		}
	}

	if oldestID == "" {
		return
	}

	pty, pok := t.ptys[oldestID]
	delete(t.ptys, oldestID)
	delete(t.lastUsed, oldestID)

	if pok && pty != nil {
		_ = pty.Close()
	}

	_ = t.sessionSvc.Disconnect(oldestID)
}
