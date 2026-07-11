package service

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"sync"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"

	"mssh/internal/model"
	ssh "mssh/internal/ssh"
	"mssh/internal/store"
	"mssh/pkg/event"
)

type EventBus interface {
	Emit(name string, payload interface{})
}

type SessionService struct {
	db        *sql.DB
	mu        sync.RWMutex
	conns     map[string]*ssh.ClientWrapper
	attempts  map[string]*connectAttempt
	eventBus  EventBus
	keepAlive int
	dataDir   string
	crypto    KeyCrypto
	logger    *slog.Logger
}

type connectAttempt struct {
	cancel   context.CancelFunc
	decision chan bool
}

func NewSessionService(db *sql.DB, eventBus EventBus, keepAlive int, dataDir string, crypto KeyCrypto, logger *slog.Logger) *SessionService {
	return &SessionService{
		db:        db,
		conns:     make(map[string]*ssh.ClientWrapper),
		attempts:  make(map[string]*connectAttempt),
		eventBus:  eventBus,
		keepAlive: keepAlive,
		dataDir:   dataDir,
		crypto:    crypto,
		logger:    logger,
	}
}

func (s *SessionService) ListFolders() ([]model.SessionFolder, error) {
	s.logger.Info("listing folders")
	return store.ListFolders(s.db)
}

func (s *SessionService) CreateFolder(name string, parentID *int64) (*model.SessionFolder, error) {
	s.logger.Info("creating folder", "name", name, "parentID", parentID)
	result, err := store.CreateFolder(s.db, name, parentID)
	if err != nil {
		s.logger.Error("create folder failed", "error", err)
	}
	return result, err
}

func (s *SessionService) UpdateFolder(id int64, name string) error {
	s.logger.Info("updating folder", "id", id, "name", name)
	err := store.UpdateFolder(s.db, id, name)
	if err != nil {
		s.logger.Error("update folder failed", "error", err)
	}
	return err
}

func (s *SessionService) DeleteFolder(id int64) error {
	s.logger.Info("deleting folder", "id", id)
	err := store.DeleteFolder(s.db, id)
	if err != nil {
		s.logger.Error("delete folder failed", "error", err)
	}
	return err
}

func (s *SessionService) SetDefaultFolder(id int64) error {
	s.logger.Info("setting default folder", "id", id)
	return store.SetDefaultFolder(s.db, id)
}

func (s *SessionService) MoveFolder(id int64, newParentID *int64) error {
	s.logger.Info("moving folder", "id", id, "newParentID", newParentID)
	err := store.MoveFolder(s.db, id, newParentID)
	if err != nil {
		s.logger.Error("move folder failed", "error", err)
	}
	return err
}

func (s *SessionService) ListSessions(folderID *int64) ([]model.Session, error) {
	s.logger.Info("listing sessions", "folderID", folderID)
	return store.ListSessions(s.db, folderID)
}

func (s *SessionService) CreateSession(session model.Session) (*model.Session, error) {
	s.logger.Info("creating session", "name", session.Name, "authMethod", session.AuthMethod, "passwordLen", len(session.Password))
	result, err := store.CreateSession(s.db, session)
	if err != nil {
		s.logger.Error("create session failed", "error", err)
	}
	return result, err
}

func (s *SessionService) UpdateSession(session model.Session) error {
	s.logger.Info("updating session", "id", session.ID, "name", session.Name, "passwordLen", len(session.Password))
	err := store.UpdateSession(s.db, session)
	if err != nil {
		s.logger.Error("update session failed", "error", err)
	}
	return err
}

func (s *SessionService) DeleteSession(id int64) error {
	s.logger.Info("deleting session", "id", id)
	err := store.DeleteSession(s.db, id)
	if err != nil {
		s.logger.Error("delete session failed", "error", err)
	}
	return err
}

func (s *SessionService) MoveSession(id int64, newFolderID *int64) error {
	s.logger.Info("moving session", "id", id, "newFolderID", newFolderID)
	err := store.MoveSession(s.db, id, newFolderID)
	if err != nil {
		s.logger.Error("move session failed", "error", err)
	}
	return err
}

func (s *SessionService) GetSession(id int64) (*model.Session, error) {
	s.logger.Info("getting session", "id", id)
	return store.GetSession(s.db, id)
}

func (s *SessionService) Connect(ctx context.Context, sessionID int64) (string, error) {
	s.logger.Info("connecting to session", "sessionID", sessionID)
	connectCtx, cancel := context.WithCancel(ctx)
	attemptID := s.registerConnectAttempt(cancel)
	defer s.finishConnectAttempt(attemptID)
	s.eventBus.Emit(event.ConnectionAttempt, event.ConnectionStatePayload{
		AttemptID: attemptID,
		State:     "connecting",
	})
	sess, err := store.GetSession(s.db, sessionID)
	if err != nil {
		s.logger.Error("connect failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("connect: %w", err)
	}

	authMethods, err := s.buildAuthMethods(sess)
	if err != nil {
		s.logger.Error("build auth methods failed", "error", err)
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
		s.logger.Error("connect failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("connect: %w", err)
	}

	terminalID := generateTerminalID()

	s.mu.Lock()
	s.conns[terminalID] = wrapper
	s.mu.Unlock()

	s.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{
		TerminalID: terminalID,
		AttemptID:  attemptID,
		State:      "connected",
	})

	s.logger.Info("connected to session", "sessionID", sessionID, "terminalID", terminalID)
	return terminalID, nil
}

func (s *SessionService) registerConnectAttempt(cancel context.CancelFunc) string {
	attemptID := generateConnectionAttemptID()
	s.mu.Lock()
	s.attempts[attemptID] = &connectAttempt{
		cancel:   cancel,
		decision: make(chan bool, 1),
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
	s.mu.RLock()
	attempt, ok := s.attempts[attemptID]
	s.mu.RUnlock()
	if !ok {
		return false
	}
	s.eventBus.Emit(event.HostKeyFingerprint, event.HostKeyPayload{
		AttemptID:   attemptID,
		Hostname:    hostname,
		Fingerprint: fingerprint,
		Algorithm:   algorithm,
	})
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

func (s *SessionService) Disconnect(terminalID string) error {
	s.logger.Info("disconnecting terminal", "terminalID", terminalID)
	s.mu.Lock()
	wrapper, ok := s.conns[terminalID]
	if !ok {
		s.mu.Unlock()
		s.logger.Error("disconnect failed", "terminalID", terminalID, "error", "terminal not found")
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	delete(s.conns, terminalID)
	s.mu.Unlock()

	_ = wrapper.Close()

	s.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{
		TerminalID: terminalID,
		State:      "disconnected",
	})

	s.logger.Info("terminal disconnected", "terminalID", terminalID)
	return nil
}

func (s *SessionService) GetClientWrapper(connID string) (*ssh.ClientWrapper, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	wrapper, ok := s.conns[connID]
	if !ok {
		return nil, fmt.Errorf("connection %s not found", connID)
	}
	return wrapper, nil
}

func (s *SessionService) ConnectionCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.conns)
}

func (s *SessionService) buildAuthMethods(sess *model.Session) ([]gossh.AuthMethod, error) {
	switch sess.AuthMethod {
	case model.AuthPassword:
		return s.buildPasswordAuth(sess)
	case model.AuthKey:
		return s.buildKeyAuth(sess)
	case model.AuthKeyboardInteractive:
		return s.buildKeyboardInteractiveAuth(sess), nil
	case model.AuthAgent:
		return s.buildAgentAuth()
	default:
		return nil, nil
	}
}

func (s *SessionService) buildPasswordAuth(sess *model.Session) ([]gossh.AuthMethod, error) {
	s.logger.Info("using password auth", "passwordLen", len(sess.Password))
	methods := []gossh.AuthMethod{gossh.Password(sess.Password)}
	if sess.Password != "" {
		methods = append(methods, s.buildKeyboardInteractiveAuth(sess)...)
	}
	return methods, nil
}

func (s *SessionService) buildKeyAuth(sess *model.Session) ([]gossh.AuthMethod, error) {
	if sess.KeyID == nil {
		return nil, fmt.Errorf("build auth methods: key auth requires key_id")
	}
	key, err := store.GetKey(s.db, *sess.KeyID)
	if err != nil {
		return nil, fmt.Errorf("build auth methods: load key %d: %w", *sess.KeyID, err)
	}
	keyData, err := s.decryptPrivateKey(key.PrivateKey)
	if err != nil {
		return nil, err
	}
	signer, signErr := gossh.ParsePrivateKey(keyData)
	if signErr != nil {
		return nil, fmt.Errorf("build auth methods: parse private key: %w", signErr)
	}
	return []gossh.AuthMethod{gossh.PublicKeys(signer)}, nil
}

func (s *SessionService) decryptPrivateKey(encrypted string) ([]byte, error) {
	if s.crypto != nil {
		decrypted, decErr := s.crypto.Decrypt([]byte(encrypted))
		if decErr != nil {
			return nil, fmt.Errorf("build auth methods: decrypt private key: %w", decErr)
		}
		return decrypted, nil
	}
	return []byte(encrypted), nil
}

func (s *SessionService) buildKeyboardInteractiveAuth(sess *model.Session) []gossh.AuthMethod {
	return []gossh.AuthMethod{gossh.KeyboardInteractive(
		func(_, _ string, questions []string, _ []bool) ([]string, error) {
			answers := make([]string, len(questions))
			for i := range answers {
				answers[i] = sess.Password
			}
			return answers, nil
		},
	)}
}

func (s *SessionService) buildAgentAuth() ([]gossh.AuthMethod, error) {
	socketPath := os.Getenv("SSH_AUTH_SOCK")
	if socketPath == "" {
		return nil, fmt.Errorf("SSH_AUTH_SOCK not set")
	}
	sock, err := net.Dial("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("ssh agent: %w", err)
	}
	agentClient := agent.NewClient(sock)
	signers, err := agentClient.Signers()
	if err != nil {
		return nil, fmt.Errorf("ssh agent signers: %w", err)
	}
	return []gossh.AuthMethod{gossh.PublicKeys(signers...)}, nil
}

func generateTerminalID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("term-%x", b)
}

func generateConnectionAttemptID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("connect-%x", b)
}
