package service

import (
	"database/sql"
	"fmt"
	"log/slog"
	"sync"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

type TunnelState struct {
	ID       int64
	connID   string
	closed   func() error
	starting bool
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

func (t *TunnelService) Create(input model.TunnelInput) (*model.Tunnel, error) {
	tunnel := input.Tunnel()
	t.logger.Info("creating tunnel", "name", tunnel.Name, "type", tunnel.Type)
	return store.CreateTunnel(t.db, tunnel)
}

func (t *TunnelService) Update(input model.TunnelInput) error {
	tunnel := input.Tunnel()
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
		if state.connID != "" {
			_ = t.sessions.disconnect(state.connID, false)
		}
	} else {
		t.mu.Unlock()
	}
	return store.DeleteTunnel(t.db, id)
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
	if state.connID != "" {
		_ = t.sessions.disconnect(state.connID, false)
	}

	t.eventBus.Emit(event.TunnelState, event.ConnectionStatePayload{
		TerminalID: fmt.Sprintf("tunnel-%d", tunnelID),
		State:      "stopped",
	})

	return nil
}
