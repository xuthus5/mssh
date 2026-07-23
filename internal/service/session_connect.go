package service

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

const defaultKeepAliveSettingKey = "terminal.default_keep_alive"

func (s *SessionService) connect(ctx context.Context, sessionID int64, emitState bool) (string, error) {
	s.logger.Info("connecting to session", "sessionID", sessionID)
	connectCtx, cancel := context.WithCancel(ctx)
	attemptID := s.registerConnectAttempt(sessionID, cancel)
	defer s.finishConnectAttempt(attemptID)
	s.eventBus.Emit(event.ConnectionAttempt, event.ConnectionStatePayload{AttemptID: attemptID, State: "connecting"})
	sess, err := s.sessionForConnect(sessionID)
	if err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	if err := s.resolveKeepAlive(sess); err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	authMethods, cleanup, err := s.buildAuthBundle(sess)
	if err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	if strings.TrimSpace(s.dataDir) == "" {
		if cleanup != nil {
			cleanup()
		}
		return "", fmt.Errorf("connect: application data directory is required for host key verification")
	}
	knownHostsPath := filepath.Join(s.dataDir, "known_hosts")
	onNewHostKey := func(hostname, algorithm, fingerprint string) bool {
		return s.awaitHostKeyDecision(connectCtx, attemptID, hostname, algorithm, fingerprint)
	}
	wrapper, err := ssh.ConnectWithVerifier(connectCtx, *sess, authMethods, knownHostsPath, onNewHostKey, s.logger)
	if err != nil {
		if cleanup != nil {
			cleanup()
		}
		return "", fmt.Errorf("connect: %w", err)
	}
	terminalID := generateTerminalID()
	s.mu.Lock()
	s.conns[terminalID] = &managedConn{wrapper: wrapper, cleanup: cleanup, sessionID: sessionID}
	s.mu.Unlock()
	if err := store.MarkSessionConnected(s.db, sessionID); err != nil {
		s.logger.Error("mark session connected failed", "sessionID", sessionID, "error", err)
	}
	if emitState {
		s.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{TerminalID: terminalID, AttemptID: attemptID, State: "connected"})
	}
	return terminalID, nil
}

func (s *SessionService) resolveKeepAlive(session *model.Session) error {
	if session.KeepAlive > 0 {
		return nil
	}
	setting, err := store.GetSettingEntry(s.db, defaultKeepAliveSettingKey)
	if err != nil {
		return fmt.Errorf("load default keep-alive: %w", err)
	}
	keepAlive := s.keepAlive
	if setting != nil {
		var configured int
		if parseErr := json.Unmarshal([]byte(setting.Value), &configured); parseErr != nil || configured <= 0 {
			s.logger.Warn("invalid default keep-alive setting", "value", setting.Value, "error", parseErr)
		} else {
			keepAlive = configured
		}
	}
	session.KeepAlive = keepAlive
	return nil
}

func (s *SessionService) registerConnectAttempt(sessionID int64, cancel context.CancelFunc) string {
	attemptID := generateConnectionAttemptID()
	s.mu.Lock()
	s.attempts[attemptID] = &connectAttempt{cancel: cancel, decision: make(chan bool, 1), sessionID: sessionID}
	s.mu.Unlock()
	return attemptID
}

func (s *SessionService) finishConnectAttempt(attemptID string) {
	s.mu.Lock()
	delete(s.attempts, attemptID)
	s.mu.Unlock()
}

func (s *SessionService) awaitHostKeyDecision(ctx context.Context, attemptID, hostname, algorithm, fingerprint string) bool {
	s.mu.RLock()
	attempt, ok := s.attempts[attemptID]
	s.mu.RUnlock()
	if !ok {
		return false
	}
	payload := event.HostKeyPayload{AttemptID: attemptID, Hostname: hostname, Fingerprint: fingerprint, Algorithm: algorithm}
	s.eventBus.Emit(event.HostKeyFingerprint, payload)
	if accepter, ok := s.eventBus.(hostKeyAutoAccepter); ok && accepter.AutoAcceptHostKeys() {
		return true
	}
	select {
	case accept := <-attempt.decision:
		return accept
	case <-ctx.Done():
		return false
	}
}

func (s *SessionService) DecideHostKey(attemptID string, accept bool) error {
	if strings.TrimSpace(attemptID) == "" {
		return fmt.Errorf("invalid connection attempt id")
	}
	s.mu.RLock()
	attempt, ok := s.attempts[attemptID]
	s.mu.RUnlock()
	if !ok {
		return fmt.Errorf("connection attempt %s not found", attemptID)
	}
	select {
	case attempt.decision <- accept:
		return nil
	default:
		return fmt.Errorf("host key decision already provided for attempt %s", attemptID)
	}
}

func (s *SessionService) CancelConnect(attemptID string) error {
	if strings.TrimSpace(attemptID) == "" {
		return fmt.Errorf("invalid connection attempt id")
	}
	s.mu.Lock()
	attempt, ok := s.attempts[attemptID]
	if ok {
		delete(s.attempts, attemptID)
	}
	s.mu.Unlock()
	if !ok {
		return fmt.Errorf("connection attempt %s not found", attemptID)
	}
	attempt.cancel()
	return nil
}

// CancelConnectForSessions aborts in-flight connect attempts for sessions about to be deleted.
//
//wails:ignore
func (s *SessionService) CancelConnectForSessions(sessionIDs []int64) {
	if s == nil || len(sessionIDs) == 0 {
		return
	}
	wanted := make(map[int64]struct{}, len(sessionIDs))
	for _, sessionID := range sessionIDs {
		if sessionID > 0 {
			wanted[sessionID] = struct{}{}
		}
	}
	if len(wanted) == 0 {
		return
	}

	s.mu.Lock()
	cancels := make([]context.CancelFunc, 0)
	for attemptID, attempt := range s.attempts {
		if attempt == nil {
			continue
		}
		if _, ok := wanted[attempt.sessionID]; !ok {
			continue
		}
		cancels = append(cancels, attempt.cancel)
		delete(s.attempts, attemptID)
	}
	s.mu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
}
