package service

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/model"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/pkg/event"
)

type TerminalService struct {
	mu              sync.RWMutex
	outputMu        sync.Mutex
	ptys            map[string]*ssh.PTYSession
	connIDs         map[string]string
	attached        map[string]bool
	pendingOutput   map[string][]byte
	outputSequences map[string]uint64
	eventBus        EventBus
	maxSize         int
	lastUsed        map[string]time.Time
	sessionSvc      *SessionService
	outputHandler   func(terminalID string, data []byte)
	closeHandler    func(terminalID string)
	systemMu        sync.Mutex
	systemSamples   map[string]systemSample
	logger          *slog.Logger
}

var _openPTY = ssh.PreparePTY

func (t *TerminalService) SetOutputHandler(fn func(terminalID string, data []byte)) {
	t.mu.Lock()
	t.outputHandler = fn
	t.mu.Unlock()
}

func (t *TerminalService) SetCloseHandler(fn func(terminalID string)) {
	t.mu.Lock()
	t.closeHandler = fn
	t.mu.Unlock()
}

func NewTerminalService(sessionSvc *SessionService, eventBus EventBus, maxSize int, logger *slog.Logger) *TerminalService {
	if maxSize <= 0 {
		maxSize = 32
	}
	return &TerminalService{
		ptys:            make(map[string]*ssh.PTYSession),
		connIDs:         make(map[string]string),
		attached:        make(map[string]bool),
		pendingOutput:   make(map[string][]byte),
		outputSequences: make(map[string]uint64),
		eventBus:        eventBus,
		maxSize:         maxSize,
		lastUsed:        make(map[string]time.Time),
		sessionSvc:      sessionSvc,
		logger:          logger,
		systemSamples:   make(map[string]systemSample),
	}
}

func (t *TerminalService) Open(ctx context.Context, sessionID int64, cols, rows int) (string, error) {
	outcome := "failed"
	defer func() {
		recordAudit(t.sessionSvc.db, t.logger, model.AuditEvent{Action: "connect", TargetType: "session", TargetID: fmt.Sprint(sessionID), SessionID: &sessionID, Summary: "SSH 连接", Outcome: outcome})
	}()
	t.logger.Info("opening terminal", "sessionID", sessionID, "cols", cols, "rows", rows)
	connID, err := t.sessionSvc.connect(ctx, sessionID, false)
	if err != nil {
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	wrapper, err := t.sessionSvc.GetClientWrapper(connID)
	if err != nil {
		_ = t.sessionSvc.disconnect(connID, false)
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	sess, err := t.sessionSvc.GetSession(sessionID)
	if err != nil {
		_ = t.sessionSvc.disconnect(connID, false)
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	termType := sess.TermType
	if termType == "" {
		termType = "xterm-256color"
	}

	terminalID := uuid.New().String()
	pty, err := _openPTY(wrapper, termType, cols, rows)
	if err != nil {
		_ = t.sessionSvc.disconnect(connID, false)
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	t.mu.Lock()
	if len(t.ptys) >= t.maxSize {
		t.evictLRU()
	}
	t.ptys[terminalID] = pty
	t.connIDs[terminalID] = connID
	t.lastUsed[terminalID] = time.Now()
	t.mu.Unlock()
	pty.SetReadCallback(func(data []byte) { t.handlePTYOutput(terminalID, data) })
	exitReady := make(chan struct{})
	pty.SetExitCallback(func(err error) {
		<-exitReady
		t.handlePTYExit(terminalID, pty, err)
	})
	pty.Start()
	t.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{TerminalID: terminalID, State: "connected"})
	close(exitReady)

	t.logger.Info("terminal opened", "terminalID", terminalID)
	outcome = "success"
	return terminalID, nil
}

func (t *TerminalService) handlePTYExit(terminalID string, exitedPTY *ssh.PTYSession, exitErr error) {
	t.mu.Lock()
	currentPTY, ok := t.ptys[terminalID]
	if !ok || currentPTY != exitedPTY {
		t.mu.Unlock()
		return
	}
	t.outputMu.Lock()
	delete(t.ptys, terminalID)
	delete(t.lastUsed, terminalID)
	if t.attached[terminalID] {
		delete(t.attached, terminalID)
		delete(t.pendingOutput, terminalID)
	}
	connID := t.connIDs[terminalID]
	delete(t.connIDs, terminalID)
	delete(t.outputSequences, terminalID)
	closeHandler := t.closeHandler
	expirePending := !t.attached[terminalID] && len(t.pendingOutput[terminalID]) > 0
	t.mu.Unlock()

	if closeHandler != nil {
		closeHandler(terminalID)
	}
	if t.sessionSvc != nil && connID != "" {
		if err := t.sessionSvc.disconnect(connID, false); err != nil {
			t.logger.Debug("remote terminal connection cleanup failed", "terminalID", terminalID, "error", err)
		}
	}
	t.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{
		TerminalID: terminalID,
		State:      "disconnected",
	})
	t.outputMu.Unlock()
	if expirePending {
		time.AfterFunc(pendingOutputTTL, func() { t.expirePendingOutput(terminalID) })
	}
	t.logger.Info("terminal disconnected by remote", "terminalID", terminalID, "error", exitErr)
}

func (t *TerminalService) Write(terminalID string, data string) (int, error) {
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

	return pty.Write([]byte(data))
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
		if _, buffered := t.pendingOutput[terminalID]; buffered {
			t.outputMu.Lock()
			delete(t.pendingOutput, terminalID)
			delete(t.attached, terminalID)
			delete(t.outputSequences, terminalID)
			t.mu.Unlock()
			t.eventBus.Emit(event.TerminalClosed, event.ConnectionStatePayload{TerminalID: terminalID, State: "closed"})
			t.outputMu.Unlock()
			return nil
		}
		t.mu.Unlock()
		t.logger.Error("close terminal failed", "terminalID", terminalID, "error", "terminal not found")
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	t.outputMu.Lock()
	delete(t.ptys, terminalID)
	delete(t.lastUsed, terminalID)
	delete(t.attached, terminalID)
	delete(t.pendingOutput, terminalID)
	delete(t.outputSequences, terminalID)
	connID := t.connIDs[terminalID]
	delete(t.connIDs, terminalID)
	closeHandler := t.closeHandler
	t.mu.Unlock()

	if pty != nil {
		_ = pty.Close()
	}

	if closeHandler != nil {
		closeHandler(terminalID)
	}
	if t.sessionSvc != nil {
		if connID == "" {
			connID = terminalID
		}
		_ = t.sessionSvc.disconnect(connID, false)
	}

	t.eventBus.Emit(event.TerminalClosed, event.ConnectionStatePayload{
		TerminalID: terminalID,
		State:      "closed",
	})
	t.outputMu.Unlock()

	t.logger.Info("terminal closed", "terminalID", terminalID)
	return nil
}

func (t *TerminalService) Count() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.ptys)
}

func (t *TerminalService) SetMaxSize(maxSize int) error {
	if maxSize <= 0 {
		return fmt.Errorf("max terminal pool size must be greater than zero")
	}
	t.mu.Lock()
	t.maxSize = maxSize
	t.mu.Unlock()
	return nil
}
