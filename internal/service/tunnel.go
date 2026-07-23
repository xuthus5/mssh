package service

import (
	"database/sql"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"unicode/utf8"

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
	if err := validateTunnelBind(tunnel); err != nil {
		return nil, err
	}
	t.logger.Info("creating tunnel", "name", tunnel.Name, "type", tunnel.Type)
	return store.CreateTunnel(t.db, tunnel)
}

func (t *TunnelService) Update(input model.TunnelInput) error {
	tunnel := input.Tunnel()
	if tunnel.ID <= 0 {
		return fmt.Errorf("invalid tunnel id")
	}
	if err := validateTunnelBind(tunnel); err != nil {
		return err
	}
	t.logger.Info("updating tunnel", "id", tunnel.ID, "name", tunnel.Name)
	return store.UpdateTunnel(t.db, tunnel)
}

func (t *TunnelService) Delete(id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid tunnel id")
	}
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
	if tunnelID <= 0 {
		return fmt.Errorf("invalid tunnel id")
	}
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

func (t *TunnelService) StopAll() {
	t.mu.Lock()
	states := make([]*TunnelState, 0, len(t.tunnels))
	for id, state := range t.tunnels {
		states = append(states, state)
		delete(t.tunnels, id)
	}
	t.mu.Unlock()
	for _, state := range states {
		if state.closed != nil {
			_ = state.closed()
		}
		if state.connID != "" {
			_ = t.sessions.disconnect(state.connID, false)
		}
	}
}

const (
	tunnelNameLimit = 128
	tunnelHostLimit = 255
)

func validateTunnelBind(tunnel model.Tunnel) error {
	if err := validateTunnelIdentity(tunnel); err != nil {
		return err
	}
	if err := validateTunnelPorts(tunnel); err != nil {
		return err
	}
	if err := validateTunnelHosts(tunnel); err != nil {
		return err
	}
	return validateTunnelLocalLoopback(tunnel)
}

func validateTunnelIdentity(tunnel model.Tunnel) error {
	if tunnel.SessionID <= 0 {
		return fmt.Errorf("session_id is required")
	}
	name := strings.TrimSpace(tunnel.Name)
	if name == "" || utf8.RuneCountInString(name) > tunnelNameLimit {
		return fmt.Errorf("name must contain between 1 and %d characters", tunnelNameLimit)
	}
	if strings.ContainsRune(name, 0) {
		return fmt.Errorf("name contains NUL")
	}
	switch tunnel.Type {
	case model.TunnelLocal, model.TunnelRemote, model.TunnelDynamic:
		return nil
	default:
		return fmt.Errorf("unsupported tunnel type %q", tunnel.Type)
	}
}

func validateTunnelPorts(tunnel model.Tunnel) error {
	if tunnel.LocalPort < 0 || tunnel.LocalPort > 65535 {
		return fmt.Errorf("local port out of range")
	}
	if tunnel.Type != model.TunnelDynamic && (tunnel.RemotePort < 1 || tunnel.RemotePort > 65535) {
		return fmt.Errorf("remote port must be between 1 and 65535")
	}
	return nil
}

func validateTunnelHosts(tunnel model.Tunnel) error {
	if err := validateTunnelHostField("local_host", tunnel.LocalHost, true); err != nil {
		return err
	}
	if tunnel.Type == model.TunnelDynamic {
		return nil
	}
	return validateTunnelHostField("remote_host", tunnel.RemoteHost, false)
}

func validateTunnelLocalLoopback(tunnel model.Tunnel) error {
	if tunnel.Type != model.TunnelLocal && tunnel.Type != model.TunnelDynamic {
		return nil
	}
	host := strings.TrimSpace(tunnel.LocalHost)
	if host == "" || isLoopbackHost(host) {
		return nil
	}
	return fmt.Errorf("local/dynamic tunnels must bind loopback (127.0.0.1, ::1, localhost); got %q", host)
}

func validateTunnelHostField(field, host string, allowEmpty bool) error {
	host = strings.TrimSpace(host)
	if host == "" {
		if allowEmpty {
			return nil
		}
		return fmt.Errorf("%s is required", field)
	}
	if strings.ContainsRune(host, 0) {
		return fmt.Errorf("%s contains NUL", field)
	}
	if utf8.RuneCountInString(host) > tunnelHostLimit {
		return fmt.Errorf("%s must not exceed %d characters", field, tunnelHostLimit)
	}
	return nil
}

func isLoopbackHost(host string) bool {
	normalized := strings.Trim(strings.ToLower(host), "[]")
	if normalized == "localhost" || normalized == "127.0.0.1" || normalized == "::1" {
		return true
	}
	ip := net.ParseIP(normalized)
	return ip != nil && ip.IsLoopback()
}
