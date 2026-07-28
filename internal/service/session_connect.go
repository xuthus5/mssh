package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

const (
	defaultKeepAliveSettingKey = "terminal.default_keep_alive"
	hostKeyDecisionTimeout     = 5 * time.Minute
)

func (s *SessionService) connect(ctx context.Context, sessionID int64, emitState bool) (string, error) {
	operationDone, err := s.beginOperation()
	if err != nil {
		return "", err
	}
	defer operationDone()
	s.logger.Info("connecting to session", "sessionID", sessionID)
	connectCtx, attemptID, generation, finish, err := s.beginConnect(ctx, sessionID)
	if err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	defer finish()
	s.eventBus.Emit(event.ConnectionAttempt, event.ConnectionStatePayload{AttemptID: attemptID, State: "connecting"})
	sess, err := s.sessionForConnect(sessionID)
	if err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	if err := s.resolveKeepAlive(sess); err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	authMethods, cleanup, err := s.buildAuthBundleContext(connectCtx, sess)
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
	if err := connectCtx.Err(); err != nil {
		return "", errors.Join(fmt.Errorf("connect: %w", err), closeRejectedConnection(wrapper, cleanup))
	}
	terminalID, err := s.registerConnectedSession(sessionID, generation, &managedConn{wrapper: wrapper, cleanup: cleanup})
	if err != nil {
		return "", errors.Join(fmt.Errorf("connect: %w", err), closeRejectedConnection(wrapper, cleanup))
	}
	if err := store.MarkSessionConnected(s.db, sessionID); err != nil {
		s.logger.Error("mark session connected failed", "sessionID", sessionID, "error", err)
	}
	if emitState {
		s.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{TerminalID: terminalID, AttemptID: attemptID, State: "connected"})
	}
	return terminalID, nil
}

func closeRejectedConnection(wrapper *ssh.ClientWrapper, cleanup func()) error {
	if cleanup != nil {
		cleanup()
	}
	if wrapper == nil {
		return nil
	}
	if err := wrapper.Close(); err != nil {
		return fmt.Errorf("close rejected SSH connection: %w", err)
	}
	return nil
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
	s.attempts[attemptID] = &connectAttempt{
		cancel: cancel, decision: make(chan bool, 1), sessionID: sessionID,
		generation: s.sessionDeletionGenerationLocked(sessionID),
	}
	s.mu.Unlock()
	return attemptID
}

func (s *SessionService) finishConnectAttempt(attemptID string) {
	s.mu.Lock()
	delete(s.attempts, attemptID)
	s.mu.Unlock()
}

func (s *SessionService) awaitHostKeyDecision(ctx context.Context, attemptID, hostname, algorithm, fingerprint string) bool {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return false
	}
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
	decisionCtx, cancel := context.WithTimeout(ctx, hostKeyDecisionTimeout)
	defer cancel()
	select {
	case accept := <-attempt.decision:
		return accept && decisionCtx.Err() == nil
	case <-decisionCtx.Done():
		if s.logger != nil {
			s.logger.Warn("host key decision ended", "attemptID", attemptID, "hostname", hostname, "error", decisionCtx.Err())
		}
		return false
	}
}

func (s *SessionService) DecideHostKey(attemptID string, accept bool) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if strings.TrimSpace(attemptID) == "" {
		return fmt.Errorf("invalid connection attempt id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	attempt, ok := s.attempts[attemptID]
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
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
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
	wanted := positiveSessionIDs(sessionIDs)
	if len(wanted) == 0 {
		return
	}

	s.mu.Lock()
	cancels := s.cancelConnectAttemptsForSessionsLocked(wanted)
	s.mu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
}

func (s *SessionService) cancelConnectAttemptsForSessionsLocked(wanted map[int64]struct{}) []context.CancelFunc {
	cancels := make([]context.CancelFunc, 0)
	for attemptID, attempt := range s.attempts {
		if attempt == nil {
			continue
		}
		if _, ok := wanted[attempt.sessionID]; !ok {
			continue
		}
		if attempt.cancel != nil {
			cancels = append(cancels, attempt.cancel)
		}
		delete(s.attempts, attemptID)
	}
	return cancels
}
