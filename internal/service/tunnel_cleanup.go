package service

import (
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/xuthus5/mssh/pkg/event"
)

var tunnelStartCleanupTimeout = 10 * time.Second

func (t *TunnelService) Stop(tunnelID int64) error {
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
	t.logger.Info("stopping tunnel", "tunnelID", tunnelID)
	state, active, err := t.beginTunnelCleanup(tunnelID)
	if err != nil {
		return err
	}
	if !active {
		return fmt.Errorf("tunnel %d not running", tunnelID)
	}
	cleanupErr := t.cleanupTunnelState(state, true)
	t.finishTunnelCleanup(state, cleanupErr == nil)
	return cleanupErr
}

// StopAll closes every tunnel runtime during application shutdown.
//
//wails:ignore
func (t *TunnelService) StopAll() {
	if t == nil {
		return
	}
	if err := t.StopAllWithError(); err != nil && t.logger != nil {
		t.logger.Warn("stop tunnels failed", "error", err)
	}
}

// StopAllWithError closes all tunnel runtimes and returns cleanup failures.
//
//wails:ignore
func (t *TunnelService) StopAllWithError() error {
	if t == nil {
		return nil
	}
	return t.stopAllRuntime(false)
}

// StopForSessions stops in-memory tunnels owned by the given sessions before DB rows are deleted.
//
//wails:ignore
func (t *TunnelService) StopForSessions(sessionIDs []int64) error {
	finishRuntime, err := t.beginRuntimeOperation()
	if err != nil {
		return err
	}
	defer finishRuntime()
	wanted := positiveTunnelSessionIDs(sessionIDs)
	if len(wanted) == 0 {
		return nil
	}
	states, beginErr := t.beginSessionTunnelCleanup(wanted)
	cleanupErr := beginErr
	for _, state := range states {
		err := t.cleanupTunnelState(state, true)
		t.finishTunnelCleanup(state, err == nil)
		if err != nil {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("stop tunnel %d: %w", state.ID, err))
		}
	}
	return cleanupErr
}

func (t *TunnelService) cleanupTunnelState(state *TunnelState, emit bool) error {
	if state == nil {
		return nil
	}
	t.mu.Lock()
	starting := state.starting
	t.mu.Unlock()
	if starting {
		t.cancelTunnelStart(state)
		return waitTunnelStartCleanup(state)
	}
	return t.finalizeStoppedTunnel(state, emit)
}

func waitTunnelStartCleanup(state *TunnelState) error {
	return waitTunnelStartCleanupWithin(state, tunnelStartCleanupTimeout)
}

func waitTunnelStartCleanupWithin(state *TunnelState, timeout time.Duration) error {
	if state.startDone == nil {
		return fmt.Errorf("tunnel %d start completion is unavailable", state.ID)
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-state.startDone:
		return state.startErr
	case <-timer.C:
		return fmt.Errorf("tunnel %d start cleanup timed out", state.ID)
	}
}

func positiveTunnelSessionIDs(sessionIDs []int64) map[int64]struct{} {
	wanted := make(map[int64]struct{}, len(sessionIDs))
	for _, sessionID := range sessionIDs {
		if sessionID > 0 {
			wanted[sessionID] = struct{}{}
		}
	}
	return wanted
}

func (t *TunnelService) beginSessionTunnelCleanup(wanted map[int64]struct{}) ([]*TunnelState, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	states := make([]*TunnelState, 0)
	var beginErr error
	for _, state := range t.tunnels {
		if state == nil {
			continue
		}
		if _, ok := wanted[state.sessionID]; !ok {
			continue
		}
		if state.stopping {
			beginErr = errors.Join(beginErr, fmt.Errorf("tunnel %d cleanup already in progress", state.ID))
			continue
		}
		state.stopping = true
		if state.starting {
			state.startCancelled = true
		}
		states = append(states, state)
	}
	return states, beginErr
}

func (t *TunnelService) beginTunnelCleanup(tunnelID int64) (*TunnelState, bool, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	state, active := t.tunnels[tunnelID]
	if !active {
		return nil, false, nil
	}
	if state == nil {
		return nil, true, fmt.Errorf("tunnel %d has invalid runtime state", tunnelID)
	}
	if state.stopping {
		return nil, true, fmt.Errorf("tunnel %d cleanup already in progress", tunnelID)
	}
	state.stopping = true
	if state.starting {
		state.startCancelled = true
	}
	return state, true, nil
}

func (t *TunnelService) finishTunnelCleanup(state *TunnelState, success bool) {
	if state == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.tunnels[state.ID] != state {
		return
	}
	if success {
		delete(t.tunnels, state.ID)
		return
	}
	state.stopping = false
}

func (t *TunnelService) finalizeStoppedTunnel(state *TunnelState, emit bool) error {
	if state == nil {
		return nil
	}
	cleanupErr := t.closeTunnelListener(state)
	cleanupErr = errors.Join(cleanupErr, t.disconnectTunnelSession(state))
	if cleanupErr == nil && emit {
		t.eventBus.Emit(event.TunnelState, event.ConnectionStatePayload{
			TerminalID: fmt.Sprintf("tunnel-%d", state.ID), State: "stopped",
		})
	}
	return cleanupErr
}

func (t *TunnelService) closeTunnelListener(state *TunnelState) error {
	if state.closed == nil {
		return nil
	}
	if err := state.closed(); err != nil && !errors.Is(err, net.ErrClosed) {
		return fmt.Errorf("close tunnel listener: %w", err)
	}
	state.closed = nil
	return nil
}

func (t *TunnelService) disconnectTunnelSession(state *TunnelState) error {
	if state.connID == "" {
		return nil
	}
	if t.sessions == nil {
		return errors.New("tunnel session service is unavailable")
	}
	connID := state.connID
	if t.releaseEndedTunnelSession(connID) {
		state.connID = ""
		return nil
	}
	if err := t.sessions.disconnect(connID, false); err != nil {
		return fmt.Errorf("disconnect tunnel session: %w", err)
	}
	state.connID = ""
	return nil
}

func (t *TunnelService) releaseEndedTunnelSession(connID string) bool {
	connection, exists := t.tunnelSessionConnection(connID)
	if !exists {
		return true
	}
	if !tunnelSessionTransportEnded(connection) {
		return false
	}
	if err := connection.closeConnection(); err != nil && t.logger != nil {
		t.logger.Debug("ignore close error for ended tunnel transport", "connID", connID, "error", err)
	}
	connection.closeMu.Lock()
	connection.closed = true
	connection.closeMu.Unlock()

	t.sessions.mu.Lock()
	defer t.sessions.mu.Unlock()
	registered, exists := t.sessions.conns[connID]
	if !exists {
		return true
	}
	if registered != connection {
		return false
	}
	delete(t.sessions.conns, connID)
	return true
}

func (t *TunnelService) tunnelSessionConnection(connID string) (*managedConn, bool) {
	t.sessions.mu.RLock()
	defer t.sessions.mu.RUnlock()
	connection, exists := t.sessions.conns[connID]
	return connection, exists
}

func tunnelSessionTransportEnded(connection *managedConn) bool {
	if connection == nil || connection.wrapper == nil {
		return false
	}
	done := connection.wrapper.Done()
	if done == nil {
		return false
	}
	select {
	case <-done:
		return true
	default:
		return false
	}
}
