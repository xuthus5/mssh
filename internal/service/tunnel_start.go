package service

import (
	"context"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func (t *TunnelService) Start(tunnelID int64) error {
	t.logger.Info("starting tunnel", "tunnelID", tunnelID)
	reservation, err := t.reserveTunnel(tunnelID)
	if err != nil {
		return err
	}
	found, err := t.loadTunnel(tunnelID)
	if err != nil {
		t.releaseTunnelReservation(tunnelID, reservation)
		return err
	}
	connID, closeFn, err := t.openTunnelForward(found)
	if err != nil {
		t.releaseTunnelReservation(tunnelID, reservation)
		return err
	}
	if !t.commitTunnelStart(tunnelID, reservation, connID, closeFn) {
		_ = closeFn()
		_ = t.sessions.disconnect(connID, false)
		return fmt.Errorf("tunnel %d start cancelled", tunnelID)
	}
	return nil
}

func (t *TunnelService) reserveTunnel(tunnelID int64) (*TunnelState, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, ok := t.tunnels[tunnelID]; ok {
		return nil, fmt.Errorf("tunnel %d already running", tunnelID)
	}
	reservation := &TunnelState{ID: tunnelID, starting: true}
	t.tunnels[tunnelID] = reservation
	return reservation, nil
}

func (t *TunnelService) releaseTunnelReservation(tunnelID int64, reservation *TunnelState) {
	t.mu.Lock()
	if t.tunnels[tunnelID] == reservation {
		delete(t.tunnels, tunnelID)
	}
	t.mu.Unlock()
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

func (t *TunnelService) openTunnelForward(tunnel *model.Tunnel) (string, func() error, error) {
	connID, err := t.sessions.connect(context.Background(), tunnel.SessionID, false)
	if err != nil {
		return "", nil, fmt.Errorf("tunnel start: %w", err)
	}
	wrapper, err := t.sessions.GetClientWrapper(connID)
	if err != nil {
		_ = t.sessions.disconnect(connID, false)
		return "", nil, fmt.Errorf("tunnel start: %w", err)
	}
	config := tunnelForwardConfig(tunnel)
	_, closeFn, err := ssh.StartForward(wrapper, config)
	if err != nil {
		_ = t.sessions.disconnect(connID, false)
		return "", nil, fmt.Errorf("tunnel start: %w", err)
	}
	return connID, closeFn, nil
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
	if t.tunnels[tunnelID] != reservation {
		return false
	}
	reservation.connID = connID
	reservation.closed = closeFn
	reservation.starting = false
	t.eventBus.Emit(event.TunnelState, event.ConnectionStatePayload{TerminalID: fmt.Sprintf("tunnel-%d", tunnelID), State: "running"})
	return true
}
