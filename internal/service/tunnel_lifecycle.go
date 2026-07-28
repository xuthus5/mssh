package service

import (
	"context"
	"errors"
	"fmt"
	"sync"

	ssh "github.com/xuthus5/mssh/internal/ssh"
)

var (
	errTunnelServiceStopped = errors.New("tunnel service is shutting down")
	errTunnelRuntimeClosing = errors.New("tunnel service is stopping all tunnels")
)

type tunnelStartCancellation struct {
	tunnelID int64
	cancel   context.CancelFunc
	client   *ssh.ClientWrapper
}

func (t *TunnelService) beginOperation() (func(), error) {
	if t == nil {
		return nil, errTunnelServiceStopped
	}
	return t.lifecycle.begin(errTunnelServiceStopped)
}

func (t *TunnelService) beginRuntimeOperation() (func(), error) {
	if t == nil {
		return nil, errTunnelServiceStopped
	}
	t.mu.Lock()
	if t.closing || t.shuttingDown {
		err := t.runtimeClosingErrorLocked()
		t.mu.Unlock()
		return nil, err
	}
	t.runtimeWG.Add(1)
	t.mu.Unlock()
	var finishOnce sync.Once
	return func() { finishOnce.Do(t.runtimeWG.Done) }, nil
}

func (t *TunnelService) runtimeClosingErrorLocked() error {
	if t.shuttingDown {
		return errTunnelServiceStopped
	}
	return errTunnelRuntimeClosing
}

// StopOperations rejects new public calls and cancels tunnel starts without closing running tunnels.
//
//wails:ignore
func (t *TunnelService) StopOperations() {
	if t == nil {
		return
	}
	t.lifecycle.stop()
	t.mu.Lock()
	t.shuttingDown = true
	t.closing = true
	cancellations := t.startCancellationsLocked(true)
	t.mu.Unlock()
	if err := runTunnelStartCancellations(cancellations); err != nil && t.logger != nil {
		t.logger.Warn("cancel tunnel starts during shutdown failed", "error", err)
	}
}

// WaitOperations waits for all public and runtime tunnel operations admitted before shutdown.
//
//wails:ignore
func (t *TunnelService) WaitOperations() {
	if t == nil {
		return
	}
	t.lifecycle.wait()
	t.runtimeWG.Wait()
}

// Shutdown rejects new operations, cancels starts, and closes every running tunnel.
//
//wails:ignore
func (t *TunnelService) Shutdown() error {
	if t == nil {
		return nil
	}
	t.StopOperations()
	t.WaitOperations()
	return t.stopAllRuntime(true)
}

func (t *TunnelService) stopAllRuntime(permanent bool) error {
	t.closeMu.Lock()
	defer t.closeMu.Unlock()
	cancellations := t.beginRuntimeClose(permanent)
	cancelErr := runTunnelStartCancellations(cancellations)
	t.runtimeWG.Wait()
	states := t.detachTunnelStates()
	cleanupErr := t.cleanupDetachedTunnels(states)
	if !permanent {
		t.resetRuntimeClosing()
	}
	return errors.Join(cancelErr, cleanupErr)
}

func (t *TunnelService) beginRuntimeClose(permanent bool) []tunnelStartCancellation {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closing = true
	if permanent {
		t.shuttingDown = true
	}
	return t.startCancellationsLocked(false)
}

func (t *TunnelService) startCancellationsLocked(startingOnly bool) []tunnelStartCancellation {
	cancellations := make([]tunnelStartCancellation, 0)
	for _, state := range t.tunnels {
		if state == nil || (startingOnly && !state.starting) {
			continue
		}
		state.stopping = true
		if state.starting {
			state.startCancelled = true
			cancellations = append(cancellations, tunnelStartCancellation{
				tunnelID: state.ID,
				cancel:   state.startCancel,
				client:   state.startClient,
			})
		}
	}
	return cancellations
}

func runTunnelStartCancellations(cancellations []tunnelStartCancellation) error {
	var cancelErr error
	for _, cancellation := range cancellations {
		if cancellation.cancel != nil {
			cancellation.cancel()
		}
		if cancellation.client != nil {
			if err := cancellation.client.Close(); err != nil {
				cancelErr = errors.Join(cancelErr, fmt.Errorf("cancel tunnel %d start: %w", cancellation.tunnelID, err))
			}
		}
	}
	return cancelErr
}

func (t *TunnelService) cancelTunnelStart(state *TunnelState) {
	if state == nil {
		return
	}
	t.mu.Lock()
	cancellation := tunnelStartCancellation{
		tunnelID: state.ID,
		cancel:   state.startCancel,
		client:   state.startClient,
	}
	t.mu.Unlock()
	if err := runTunnelStartCancellations([]tunnelStartCancellation{cancellation}); err != nil && t.logger != nil {
		t.logger.Warn("cancel tunnel start failed", "tunnelID", state.ID, "error", err)
	}
}

func (t *TunnelService) detachTunnelStates() []*TunnelState {
	t.mu.Lock()
	defer t.mu.Unlock()
	states := make([]*TunnelState, 0, len(t.tunnels))
	for tunnelID, state := range t.tunnels {
		states = append(states, state)
		delete(t.tunnels, tunnelID)
	}
	return states
}

func (t *TunnelService) cleanupDetachedTunnels(states []*TunnelState) error {
	var cleanupErr error
	for _, state := range states {
		if state == nil {
			continue
		}
		if err := t.cleanupTunnelState(state, false); err != nil {
			t.restoreDetachedTunnel(state)
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("stop tunnel %d: %w", state.ID, err))
		}
	}
	return cleanupErr
}

func (t *TunnelService) restoreDetachedTunnel(state *TunnelState) {
	t.mu.Lock()
	defer t.mu.Unlock()
	state.stopping = false
	t.tunnels[state.ID] = state
}

func (t *TunnelService) resetRuntimeClosing() {
	t.mu.Lock()
	if !t.shuttingDown {
		t.closing = false
	}
	t.mu.Unlock()
}
