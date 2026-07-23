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
	ptys            map[string]terminalIO
	connIDs         map[string]string
	attached        map[string]bool
	pendingOutput   map[string][]byte
	outputSequences map[string]uint64
	eventBus        EventBus
	maxSize         int
	lastUsed        map[string]time.Time
	sessionSvc      *SessionService
	serialSvc       *SerialService
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

func (t *TerminalService) SetSerialService(serialSvc *SerialService) {
	t.mu.Lock()
	t.serialSvc = serialSvc
	t.mu.Unlock()
}

func NewTerminalService(sessionSvc *SessionService, eventBus EventBus, maxSize int, logger *slog.Logger) *TerminalService {
	if maxSize <= 0 {
		maxSize = 32
	}
	return &TerminalService{
		ptys:            make(map[string]terminalIO),
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
	if err := validateTerminalSize(cols, rows); err != nil {
		return "", err
	}
	outcome := "failed"
	defer func() {
		recordAudit(t.sessionSvc.db, t.logger, model.AuditEvent{Action: "connect", TargetType: "session", TargetID: fmt.Sprint(sessionID), SessionID: &sessionID, Summary: "SSH 连接", Outcome: outcome})
	}()
	t.logger.Info("opening terminal", "sessionID", sessionID, "cols", cols, "rows", rows)
	terminalID, err := t.openTerminalSession(ctx, sessionID, cols, rows)
	if err != nil {
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}
	t.logger.Info("terminal opened", "terminalID", terminalID)
	outcome = "success"
	return terminalID, nil
}

func (t *TerminalService) openTerminalSession(ctx context.Context, sessionID int64, cols, rows int) (string, error) {
	connID, wrapper, termType, err := t.prepareTerminalConnection(ctx, sessionID)
	if err != nil {
		return "", err
	}
	terminalID := uuid.New().String()
	pty, err := _openPTY(wrapper, termType, cols, rows)
	if err != nil {
		_ = t.sessionSvc.disconnect(connID, false)
		return "", err
	}
	t.registerTerminal(terminalID, connID, pty)
	return terminalID, nil
}

func (t *TerminalService) prepareTerminalConnection(ctx context.Context, sessionID int64) (string, *ssh.ClientWrapper, string, error) {
	connID, err := t.sessionSvc.connect(ctx, sessionID, false)
	if err != nil {
		return "", nil, "", err
	}
	wrapper, err := t.sessionSvc.GetClientWrapper(connID)
	if err != nil {
		_ = t.sessionSvc.disconnect(connID, false)
		return "", nil, "", err
	}
	sess, err := t.sessionSvc.GetSession(sessionID)
	if err != nil {
		_ = t.sessionSvc.disconnect(connID, false)
		return "", nil, "", err
	}
	termType := sess.TermType
	if termType == "" {
		termType = "xterm-256color"
	}
	return connID, wrapper, termType, nil
}

func (t *TerminalService) registerTerminal(terminalID, connID string, pty terminalIO) {
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
}

func (t *TerminalService) handlePTYExit(terminalID string, exitedPTY terminalIO, exitErr error) {
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
	delete(t.systemSamples, terminalID)
	closeHandler := t.closeHandler
	expirePending := !t.attached[terminalID] && len(t.pendingOutput[terminalID]) > 0
	t.outputMu.Unlock()
	t.mu.Unlock()

	if closeHandler != nil {
		closeHandler(terminalID)
	}
	t.releaseSerialDevice(terminalID, exitedPTY)
	if t.sessionSvc != nil && connID != "" {
		if err := t.sessionSvc.disconnect(connID, false); err != nil {
			t.logger.Debug("remote terminal connection cleanup failed", "terminalID", terminalID, "error", err)
		}
	}
	t.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{
		TerminalID: terminalID,
		State:      "disconnected",
	})
	if expirePending {
		time.AfterFunc(pendingOutputTTL, func() { t.expirePendingOutput(terminalID) })
	}
	t.logger.Info("terminal disconnected by remote", "terminalID", terminalID, "error", exitErr)
}
