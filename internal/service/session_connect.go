package service

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"

	"github.com/xuthus5/mssh/internal/model"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

const defaultKeepAliveSettingKey = "terminal.default_keep_alive"

func (s *SessionService) connect(ctx context.Context, sessionID int64, emitState bool) (string, error) {
	s.logger.Info("connecting to session", "sessionID", sessionID)
	connectCtx, cancel := context.WithCancel(ctx)
	attemptID := s.registerConnectAttempt(cancel)
	defer s.finishConnectAttempt(attemptID)
	s.eventBus.Emit(event.ConnectionAttempt, event.ConnectionStatePayload{AttemptID: attemptID, State: "connecting"})
	sess, err := store.GetSession(s.db, sessionID)
	if err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	if err := s.resolveKeepAlive(sess); err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	authMethods, err := s.buildAuthMethods(sess)
	if err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	knownHostsPath := ""
	if s.dataDir != "" {
		knownHostsPath = filepath.Join(s.dataDir, "known_hosts")
	}
	onNewHostKey := func(hostname, algorithm, fingerprint string) bool {
		return s.awaitHostKeyDecision(connectCtx, attemptID, hostname, algorithm, fingerprint)
	}
	wrapper, err := ssh.ConnectWithVerifier(connectCtx, *sess, authMethods, knownHostsPath, onNewHostKey, s.logger)
	if err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	terminalID := generateTerminalID()
	s.mu.Lock()
	s.conns[terminalID] = wrapper
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

func (s *SessionService) registerConnectAttempt(cancel context.CancelFunc) string {
	attemptID := generateConnectionAttemptID()
	s.mu.Lock()
	s.attempts[attemptID] = &connectAttempt{cancel: cancel, decision: make(chan bool, 1)}
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
	s.eventBus.Emit(event.HostKeyFingerprint, event.HostKeyPayload{AttemptID: attemptID, Hostname: hostname, Fingerprint: fingerprint, Algorithm: algorithm})
	select {
	case accept := <-attempt.decision:
		return accept
	case <-ctx.Done():
		return false
	}
}

func (s *SessionService) DecideHostKey(attemptID string, accept bool) error {
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
