package service

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"sync"

	"github.com/xuthus5/mssh/internal/model"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

type TunnelState struct {
	ID     int64
	closed func() error
}

type TunnelService struct {
	db       *sql.DB
	sessions *SessionService
	eventBus EventBus
	mu       sync.Mutex
	tunnels  map[int64]*TunnelState
	logger   *slog.Logger
}

func NewTunnelService(db *sql.DB, sessions *SessionService, eventBus EventBus, logger *slog.Logger) *TunnelService {
	return &TunnelService{
		db:       db,
		sessions: sessions,
		eventBus: eventBus,
		tunnels:  make(map[int64]*TunnelState),
		logger:   logger,
	}
}

func (t *TunnelService) List() ([]model.Tunnel, error) {
	return store.ListTunnels(t.db)
}

func (t *TunnelService) Create(tunnel model.Tunnel) (*model.Tunnel, error) {
	t.logger.Info("creating tunnel", "name", tunnel.Name, "type", tunnel.Type)
	return store.CreateTunnel(t.db, tunnel)
}

func (t *TunnelService) Update(tunnel model.Tunnel) error {
	t.logger.Info("updating tunnel", "id", tunnel.ID, "name", tunnel.Name)
	return store.UpdateTunnel(t.db, tunnel)
}

func (t *TunnelService) Delete(id int64) error {
	t.logger.Info("deleting tunnel", "id", id)
	t.mu.Lock()
	if state, ok := t.tunnels[id]; ok {
		delete(t.tunnels, id)
		t.mu.Unlock()
		if state.closed != nil {
			_ = state.closed()
		}
	} else {
		t.mu.Unlock()
	}
	return store.DeleteTunnel(t.db, id)
}

func (t *TunnelService) Start(tunnelID int64) error {
	t.logger.Info("starting tunnel", "tunnelID", tunnelID)
	t.mu.Lock()
	if _, ok := t.tunnels[tunnelID]; ok {
		t.mu.Unlock()
		return fmt.Errorf("tunnel %d already running", tunnelID)
	}
	t.mu.Unlock()

	tunnel, err := store.ListTunnels(t.db)
	if err != nil {
		return fmt.Errorf("tunnel start: %w", err)
	}

	var found *model.Tunnel
	for i := range tunnel {
		if tunnel[i].ID == tunnelID {
			found = &tunnel[i]
			break
		}
	}
	if found == nil {
		return fmt.Errorf("tunnel %d not found", tunnelID)
	}

	ctx := context.Background()
	connID, err := t.sessions.Connect(ctx, found.SessionID)
	if err != nil {
		return fmt.Errorf("tunnel start: %w", err)
	}

	wrapper, err := t.sessions.GetClientWrapper(connID)
	if err != nil {
		_ = t.sessions.Disconnect(connID)
		return fmt.Errorf("tunnel start: %w", err)
	}

	if found.LocalHost == "" {
		found.LocalHost = "127.0.0.1"
	}
	if found.RemoteHost == "" {
		found.RemoteHost = "127.0.0.1"
	}

	cfg := ssh.ForwardConfig{
		Type:       found.Type,
		LocalHost:  found.LocalHost,
		LocalPort:  found.LocalPort,
		RemoteHost: found.RemoteHost,
		RemotePort: found.RemotePort,
	}

	_, closeFn, err := ssh.StartForward(wrapper, cfg)
	if err != nil {
		_ = t.sessions.Disconnect(connID)
		return fmt.Errorf("tunnel start: %w", err)
	}

	t.mu.Lock()
	t.tunnels[tunnelID] = &TunnelState{
		ID:     tunnelID,
		closed: closeFn,
	}
	t.mu.Unlock()

	t.eventBus.Emit(event.TunnelState, event.ConnectionStatePayload{
		TerminalID: fmt.Sprintf("tunnel-%d", tunnelID),
		State:      "running",
	})

	return nil
}

func (t *TunnelService) Stop(tunnelID int64) error {
	t.logger.Info("stopping tunnel", "tunnelID", tunnelID)
	t.mu.Lock()
	state, ok := t.tunnels[tunnelID]
	if !ok {
		t.mu.Unlock()
		return fmt.Errorf("tunnel %d not running", tunnelID)
	}
	delete(t.tunnels, tunnelID)
	t.mu.Unlock()

	if state.closed != nil {
		_ = state.closed()
	}

	t.eventBus.Emit(event.TunnelState, event.ConnectionStatePayload{
		TerminalID: fmt.Sprintf("tunnel-%d", tunnelID),
		State:      "stopped",
	})

	return nil
}
