package service

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/xuthus5/mssh/internal/model"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func (t *TunnelService) Start(tunnelID int64) error {
	finish, err := t.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	finishRuntime, err := t.beginRuntimeOperation()
	if err != nil {
		return err
	}
	defer finishRuntime()
	if tunnelID <= 0 {
		return fmt.Errorf("invalid tunnel id")
	}
	t.logger.Info("starting tunnel", "tunnelID", tunnelID)
	found, reservation, err := t.prepareTunnelStart(tunnelID)
	if err != nil {
		return err
	}
	var startCleanupErr error
	defer func() { t.finishTunnelStart(reservation, startCleanupErr) }()
	connID, closeFn, err := t.openTunnelForward(found, tunnelID, reservation)
	if err != nil {
		t.releaseTunnelReservation(tunnelID, reservation)
		return err
	}
	if !t.commitTunnelStart(tunnelID, reservation, connID, closeFn) {
		cleanupState := &TunnelState{
			ID: tunnelID, sessionID: found.SessionID, connID: connID, closed: closeFn,
		}
		startCleanupErr = t.finalizeStoppedTunnel(cleanupState, false)
		t.syncTunnelStartCleanup(reservation, cleanupState, startCleanupErr)
		return errors.Join(fmt.Errorf("tunnel %d start cancelled", tunnelID), startCleanupErr)
	}
	return nil
}

func (t *TunnelService) prepareTunnelStart(tunnelID int64) (*model.Tunnel, *TunnelState, error) {
	t.configMu.Lock()
	defer t.configMu.Unlock()
	found, err := t.loadTunnel(tunnelID)
	if err != nil {
		return nil, nil, err
	}
	if err := validateTunnelBind(*found); err != nil {
		return nil, nil, err
	}
	reservation, err := t.reserveTunnel(tunnelID, found.SessionID)
	if err != nil {
		return nil, nil, err
	}
	return found, reservation, nil
}

func (t *TunnelService) reserveTunnel(tunnelID, sessionID int64) (*TunnelState, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closing || t.shuttingDown {
		return nil, t.runtimeClosingErrorLocked()
	}
	if t.blockedSessions[sessionID] > 0 {
		return nil, fmt.Errorf("session deletion in progress for session %d", sessionID)
	}
	if _, ok := t.tunnels[tunnelID]; ok {
		return nil, fmt.Errorf("tunnel %d already running", tunnelID)
	}
	startCtx, cancel := context.WithCancel(context.Background())
	reservation := &TunnelState{
		ID: tunnelID, sessionID: sessionID, starting: true, startDone: make(chan struct{}),
		startCtx: startCtx, startCancel: cancel,
	}
	t.tunnels[tunnelID] = reservation
	return reservation, nil
}

func (t *TunnelService) releaseTunnelReservation(tunnelID int64, reservation *TunnelState) {
	t.mu.Lock()
	var cancel context.CancelFunc
	if t.tunnels[tunnelID] == reservation && !reservation.stopping {
		delete(t.tunnels, tunnelID)
		cancel = reservation.startCancel
		reservation.startCancel = nil
	}
	t.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (t *TunnelService) finishTunnelStart(reservation *TunnelState, cleanupErr error) {
	if reservation == nil {
		return
	}
	t.mu.Lock()
	reservation.starting = false
	reservation.startErr = cleanupErr
	done := reservation.startDone
	cancel := reservation.startCancel
	reservation.startCancel = nil
	t.releaseCancelledStartLocked(reservation, cleanupErr)
	t.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		reservation.startDoneOnce.Do(func() { close(done) })
	}
}

func (t *TunnelService) releaseCancelledStartLocked(reservation *TunnelState, cleanupErr error) {
	if cleanupErr != nil || !reservation.startCancelled || reservation.stopping {
		return
	}
	if t.tunnels[reservation.ID] != reservation {
		return
	}
	if reservation.connID == "" && reservation.closed == nil && reservation.startClient == nil {
		delete(t.tunnels, reservation.ID)
	}
}

func preserveTunnelStartCleanup(
	reservation *TunnelState,
	cleanupState *TunnelState,
	cleanupErr error,
) {
	if reservation == nil || cleanupState == nil || cleanupErr == nil {
		return
	}
	reservation.connID = cleanupState.connID
	reservation.closed = cleanupState.closed
}

func (t *TunnelService) loadTunnel(tunnelID int64) (*model.Tunnel, error) {
	tunnels, err := store.ListTunnels(t.db)
	if err != nil {
		return nil, fmt.Errorf("tunnel start: %w", err)
	}
	for index := range tunnels {
		if tunnels[index].ID == tunnelID {
			return &tunnels[index], nil
		}
	}
	return nil, fmt.Errorf("tunnel %d not found", tunnelID)
}

func (t *TunnelService) openTunnelForward(tunnel *model.Tunnel, tunnelID int64, reservation *TunnelState) (string, func() error, error) {
	if t.sessions == nil {
		return "", nil, fmt.Errorf("tunnel start: session service unavailable")
	}
	startCtx := reservation.startCtx
	if startCtx == nil {
		startCtx = context.Background()
	}
	connID, err := t.sessions.connect(startCtx, tunnel.SessionID, false)
	if err != nil {
		return "", nil, fmt.Errorf("tunnel start: %w", err)
	}
	wrapper, err := t.sessions.GetClientWrapper(connID)
	if err != nil {
		startErr := fmt.Errorf("tunnel start: %w", err)
		return "", nil, errors.Join(startErr, t.disconnectFailedTunnelStart(connID))
	}
	if !t.attachTunnelStartClient(tunnelID, reservation, connID, wrapper) {
		cleanupErr := t.disconnectFailedTunnelStart(connID)
		return "", nil, errors.Join(fmt.Errorf("tunnel %d start cancelled", tunnelID), cleanupErr)
	}
	var exitOnce sync.Once
	config := tunnelForwardConfig(tunnel)
	config.OnAcceptExit = func() {
		exitOnce.Do(func() {
			t.handleAcceptLoopExit(tunnelID, reservation)
		})
	}
	_, closeFn, err := ssh.StartForward(wrapper, config)
	if err != nil {
		startErr := fmt.Errorf("tunnel start: %w", err)
		cleanupErr := t.cleanupFailedTunnelStartConnection(reservation, connID)
		return "", nil, errors.Join(startErr, cleanupErr)
	}
	return connID, closeFn, nil
}

func (t *TunnelService) attachTunnelStartClient(tunnelID int64, reservation *TunnelState, connID string, client *ssh.ClientWrapper) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.tunnels[tunnelID] != reservation || reservation.stopping || reservation.startCancelled {
		return false
	}
	reservation.connID = connID
	reservation.startClient = client
	return true
}

func (t *TunnelService) cleanupFailedTunnelStartConnection(reservation *TunnelState, connID string) error {
	cleanupErr := t.disconnectFailedTunnelStart(connID)
	t.mu.Lock()
	if reservation.connID == connID {
		reservation.connID = ""
		reservation.startClient = nil
	}
	t.mu.Unlock()
	return cleanupErr
}

func (t *TunnelService) syncTunnelStartCleanup(reservation, cleanupState *TunnelState, cleanupErr error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	reservation.startClient = nil
	if cleanupErr == nil {
		reservation.connID = ""
		reservation.closed = nil
		return
	}
	preserveTunnelStartCleanup(reservation, cleanupState, cleanupErr)
}

func (t *TunnelService) disconnectFailedTunnelStart(connID string) error {
	if t.sessions == nil || connID == "" {
		return nil
	}
	if err := t.sessions.disconnect(connID, false); err != nil {
		return fmt.Errorf("cleanup tunnel start connection: %w", err)
	}
	return nil
}

func (t *TunnelService) handleAcceptLoopExit(tunnelID int64, reservation *TunnelState) {
	state := t.beginUnexpectedTunnelCleanup(tunnelID, reservation)
	if state == nil {
		return
	}
	cleanupErr := t.finalizeStoppedTunnel(state, true)
	t.finishTunnelCleanup(state, cleanupErr == nil)
	if cleanupErr != nil {
		if t.logger != nil {
			t.logger.Warn("cleanup exited tunnel failed", "tunnelID", tunnelID, "error", cleanupErr)
		}
		return
	}
	if t.logger != nil {
		t.logger.Info("tunnel accept loop exited", "tunnelID", tunnelID)
	}
}

func (t *TunnelService) beginUnexpectedTunnelCleanup(tunnelID int64, reservation *TunnelState) *TunnelState {
	t.mu.Lock()
	defer t.mu.Unlock()
	state := t.tunnels[tunnelID]
	if state != reservation || state.stopping {
		return nil
	}
	state.stopping = true
	return state
}

func tunnelForwardConfig(tunnel *model.Tunnel) ssh.ForwardConfig {
	localHost := tunnel.LocalHost
	if localHost == "" {
		localHost = "127.0.0.1"
	}
	remoteHost := tunnel.RemoteHost
	if remoteHost == "" {
		remoteHost = "127.0.0.1"
	}
	return ssh.ForwardConfig{Type: tunnel.Type, LocalHost: localHost, LocalPort: tunnel.LocalPort, RemoteHost: remoteHost, RemotePort: tunnel.RemotePort}
}

func (t *TunnelService) commitTunnelStart(tunnelID int64, reservation *TunnelState, connID string, closeFn func() error) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.tunnels[tunnelID] != reservation || reservation.stopping || reservation.startCancelled {
		return false
	}
	reservation.connID = connID
	reservation.closed = closeFn
	reservation.startClient = nil
	reservation.starting = false
	t.eventBus.Emit(event.TunnelState, event.ConnectionStatePayload{TerminalID: fmt.Sprintf("tunnel-%d", tunnelID), State: "running"})
	return true
}
