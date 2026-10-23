package service

import (
	"context"
	"errors"
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
	mu                             sync.RWMutex
	closeMu                        sync.Mutex
	resourceMu                     sync.Mutex
	outputMu                       sync.Mutex
	ptys                           map[string]terminalIO
	closingPTYs                    map[string]terminalIO
	pendingSerialCleanups          map[string]unregisteredSerialResource
	connIDs                        map[string]string
	sessionIDs                     map[string]int64
	pendingSessionIDs              map[string]int64
	blockedSessions                map[int64]int
	sessionOpenGenerations         map[int64]uint64
	attached                       map[string]bool
	pendingOutput                  map[string][]byte
	pendingExpiries                map[string]*pendingOutputExpiry
	outputSequences                map[string]uint64
	outputDispatchers              map[string]*sync.Mutex
	outputFlows                    map[string]*terminalOutputFlow
	probeMu                        sync.Mutex
	probeConns                     map[int64]*systemProbeConn
	probeTerminalRefs              map[int64]int
	eventBus                       EventBus
	maxSize                        int
	lastUsed                       map[string]time.Time
	sessionSvc                     *SessionService
	serialSvc                      *SerialService
	outputHandler                  func(terminalID string, data []byte)
	closeHandler                   func(terminalID string)
	systemMu                       sync.Mutex
	systemSamples                  map[string]systemSample
	operationWG                    sync.WaitGroup
	terminalDirectoryIntegrationWG sync.WaitGroup
	exitMu                         sync.Mutex
	exitWG                         sync.WaitGroup
	exitGeneration                 uint64
	exitStopping                   bool
	closing                        bool
	shuttingDown                   bool
	logger                         *slog.Logger
	traceMu                        sync.Mutex
	writeSerials                   map[string]uint64
	lastWriteDone                  map[string]time.Time
	lastOutputAt                   map[string]time.Time
	outputBatchCfg                 terminalOutputBatchConfig
	outputBatchers                 map[string]*terminalOutputBatcher
	lifecycleContext               context.Context
	lifecycleCancel                context.CancelFunc
}

var _openPTY = func(wrapper *ssh.ClientWrapper, termType string, cols, rows int) (terminalIO, error) {
	return ssh.PreparePTY(wrapper, termType, cols, rows)
}

//wails:ignore
func (t *TerminalService) SetOutputHandler(fn func(terminalID string, data []byte)) {
	t.mu.Lock()
	t.outputHandler = fn
	t.mu.Unlock()
}

//wails:ignore
func (t *TerminalService) SetCloseHandler(fn func(terminalID string)) {
	t.mu.Lock()
	t.closeHandler = fn
	t.mu.Unlock()
}

//wails:ignore
func (t *TerminalService) SetSerialService(serialSvc *SerialService) {
	t.mu.Lock()
	t.serialSvc = serialSvc
	t.mu.Unlock()
}

func NewTerminalService(sessionSvc *SessionService, eventBus EventBus, maxSize int, logger *slog.Logger) *TerminalService {
	if maxSize <= 0 {
		maxSize = DefaultTerminalPoolSize
	}
	lifecycleContext, lifecycleCancel := context.WithCancel(context.Background())
	return &TerminalService{
		ptys:                   make(map[string]terminalIO),
		closingPTYs:            make(map[string]terminalIO),
		pendingSerialCleanups:  make(map[string]unregisteredSerialResource),
		connIDs:                make(map[string]string),
		sessionIDs:             make(map[string]int64),
		pendingSessionIDs:      make(map[string]int64),
		blockedSessions:        make(map[int64]int),
		sessionOpenGenerations: make(map[int64]uint64),
		attached:               make(map[string]bool),
		pendingOutput:          make(map[string][]byte),
		pendingExpiries:        make(map[string]*pendingOutputExpiry),
		outputSequences:        make(map[string]uint64),
		outputDispatchers:      make(map[string]*sync.Mutex),
		outputFlows:            make(map[string]*terminalOutputFlow),
		probeConns:             make(map[int64]*systemProbeConn),
		probeTerminalRefs:      make(map[int64]int),
		eventBus:               eventBus,
		maxSize:                maxSize,
		lastUsed:               make(map[string]time.Time),
		sessionSvc:             sessionSvc,
		logger:                 logger,
		systemSamples:          make(map[string]systemSample),
		outputBatchCfg:         terminalOutputBatchConfigFromEnv(),
		lifecycleContext:       lifecycleContext,
		lifecycleCancel:        lifecycleCancel,
	}
}

func (t *TerminalService) Open(ctx context.Context, sessionID int64, cols, rows int) (string, error) {
	if sessionID <= 0 {
		return "", fmt.Errorf("invalid session id")
	}
	if err := validateTerminalSize(cols, rows); err != nil {
		return "", err
	}
	finish, err := t.beginOperation()
	if err != nil {
		return "", err
	}
	defer finish()
	if err := t.beginOpen(); err != nil {
		return "", err
	}
	sessionGeneration, err := t.beginSessionOpen(sessionID)
	if err != nil {
		return "", err
	}
	outcome := "failed"
	defer func() {
		recordAudit(t.sessionSvc.db, t.logger, model.AuditEvent{Action: "connect", TargetType: "session", TargetID: fmt.Sprint(sessionID), SessionID: &sessionID, Summary: "SSH 连接", Outcome: outcome})
	}()
	t.logger.Info("opening terminal", "sessionID", sessionID, "cols", cols, "rows", rows)
	terminalID, err := t.openTerminalSession(ctx, sessionID, sessionGeneration, cols, rows)
	if err != nil {
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}
	t.logger.Info("terminal opened", "terminalID", terminalID)
	outcome = "success"
	return terminalID, nil
}

func (t *TerminalService) openTerminalSession(ctx context.Context, sessionID int64, generation uint64, cols, rows int) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	prepared, err := t.prepareTerminalConnection(ctx, sessionID)
	if err != nil {
		return "", err
	}
	terminalID := uuid.New().String()
	pty, err := _openPTY(prepared.wrapper, prepared.termType, cols, rows)
	if err != nil {
		return "", errors.Join(err, t.cleanupTerminalResources(prepared.connID, nil))
	}
	if err := ctx.Err(); err != nil {
		return "", errors.Join(err, t.cleanupTerminalResources(prepared.connID, pty))
	}
	if err := writeStartupCommand(pty, prepared.startupCommand); err != nil {
		return "", errors.Join(fmt.Errorf("write startup command: %w", err), t.cleanupTerminalResources(prepared.connID, pty))
	}
	registration := terminalRegistration{
		terminalID: terminalID, connID: prepared.connID, sessionID: sessionID, generation: generation, pty: pty,
	}
	if err := t.registerSessionTerminal(registration); err != nil {
		return "", errors.Join(err, t.cleanupTerminalResources(prepared.connID, pty))
	}
	t.startTerminalDirectoryIntegration(sessionID)
	return terminalID, nil
}

func (t *TerminalService) registerTerminal(terminalID, connID string, sessionID int64, pty terminalIO) error {
	return t.registerTerminalState(terminalRegistration{
		terminalID: terminalID, connID: connID, sessionID: sessionID, pty: pty,
	})
}

func (t *TerminalService) registerSessionTerminal(registration terminalRegistration) error {
	registration.enforceGeneration = true
	return t.registerTerminalState(registration)
}

func (t *TerminalService) registerTerminalState(registration terminalRegistration) error {
	t.resourceMu.Lock()
	defer t.resourceMu.Unlock()

	t.mu.Lock()
	if err := t.validateTerminalRegistrationLocked(registration); err != nil {
		t.mu.Unlock()
		return err
	}
	maxSize := t.maxSize
	t.mu.Unlock()

	evictionErr := t.reduceTerminalCountLocked(maxSize - 1)
	t.mu.Lock()
	if err := t.validateTerminalRegistrationLocked(registration); err != nil {
		t.mu.Unlock()
		return err
	}
	if len(t.ptys) >= maxSize {
		t.mu.Unlock()
		return errors.Join(evictionErr, fmt.Errorf("terminal pool remains at capacity %d", maxSize))
	}
	t.ptys[registration.terminalID] = registration.pty
	t.outputFlowLocked(registration.terminalID)
	t.connIDs[registration.terminalID] = registration.connID
	t.sessionIDs[registration.terminalID] = registration.sessionID
	delete(t.pendingSessionIDs, registration.terminalID)
	t.lastUsed[registration.terminalID] = time.Now()
	t.addProbeTerminalRef(registration.sessionID)
	t.mu.Unlock()
	if evictionErr != nil {
		t.logger.Warn("terminal pool eviction completed with cleanup errors", "error", evictionErr)
	}
	registration.pty.SetReadCallback(func(data []byte) {
		t.traceOutputRead(registration.terminalID, data)
		t.pushTerminalOutput(registration.terminalID, data)
	})
	exitReady := make(chan struct{})
	exitGeneration := t.terminalExitGeneration()
	registration.pty.SetExitCallback(func(err error) {
		<-exitReady
		finish, ok := t.beginTerminalExitCallback(exitGeneration)
		if !ok {
			return
		}
		defer finish()
		t.handlePTYExit(registration.terminalID, registration.pty, err)
	})
	registration.pty.Start()
	t.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{TerminalID: registration.terminalID, State: "connected"})
	close(exitReady)
	return nil
}

func (t *TerminalService) validateTerminalRegistrationLocked(registration terminalRegistration) error {
	if t.maxSize <= 0 {
		return fmt.Errorf("terminal pool size must be greater than zero")
	}
	if !registration.enforceGeneration {
		return nil
	}
	if t.blockedSessions[registration.sessionID] > 0 {
		return fmt.Errorf("session deletion in progress for session %d", registration.sessionID)
	}
	if t.sessionOpenGenerations[registration.sessionID] != registration.generation {
		return fmt.Errorf("session changed during terminal open for session %d", registration.sessionID)
	}
	return nil
}
