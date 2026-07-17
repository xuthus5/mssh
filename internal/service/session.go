package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"sync"

	"github.com/google/uuid"
	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"

	"github.com/xuthus5/mssh/internal/model"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
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
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "delete", TargetType: "folder", TargetID: fmt.Sprint(id), Summary: "删除会话分组", Outcome: outcome})
	}()
	s.logger.Info("deleting folder", "id", id)
	err := store.DeleteFolder(s.db, id)
	if err != nil {
		s.logger.Error("delete folder failed", "error", err)
	} else {
		outcome = "success"
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

func (s *SessionService) ListRecentSessions(limit int) ([]model.Session, error) {
	s.logger.Info("listing recent sessions", "limit", limit)
	return store.ListRecentSessions(s.db, limit)
}

func (s *SessionService) CreateSession(input model.SessionInput) (*model.Session, error) {
	session := input.Session()
	s.logger.Info("creating session", "name", session.Name, "authMethod", session.AuthMethod)
	result, err := store.CreateSession(s.db, session)
	if err != nil {
		s.logger.Error("create session failed", "error", err)
	}
	return result, err
}

func (s *SessionService) UpdateSession(input model.SessionInput) error {
	session := input.Session()
	s.logger.Info("updating session", "id", session.ID, "name", session.Name)
	err := store.UpdateSession(s.db, session)
	if err != nil {
		s.logger.Error("update session failed", "error", err)
	}
	return err
}

func (s *SessionService) DeleteSession(id int64) error {
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "delete", TargetType: "session", TargetID: fmt.Sprint(id), SessionID: &id, Summary: "删除 SSH 会话", Outcome: outcome})
	}()
	s.logger.Info("deleting session", "id", id)
	err := store.DeleteSession(s.db, id)
	if err != nil {
		s.logger.Error("delete session failed", "error", err)
	} else {
		outcome = "success"
	}
	return err
}

func (s *SessionService) SessionDeleteImpact(id int64) (*model.SessionDeleteImpact, error) {
	impact := &model.SessionDeleteImpact{}
	queries := []struct {
		query  string
		target *int
	}{
		{"SELECT COUNT(*) FROM tunnels WHERE session_id = ?", &impact.Tunnels},
		{"SELECT COUNT(*) FROM command_history WHERE session_id = ?", &impact.History},
		{"SELECT COUNT(*) FROM session_logs WHERE session_id = ?", &impact.Recordings},
	}
	for _, item := range queries {
		if err := s.db.QueryRow(item.query, id).Scan(item.target); err != nil {
			return nil, fmt.Errorf("session delete impact: %w", err)
		}
	}
	return impact, nil
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

func (s *SessionService) disconnect(terminalID string, emitState bool) error {
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

	if emitState {
		s.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{
			TerminalID: terminalID,
			State:      "disconnected",
		})
	}

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

func (s *SessionService) CloseAll() error {
	s.mu.Lock()
	connections := make(map[string]*ssh.ClientWrapper, len(s.conns))
	for id, wrapper := range s.conns {
		connections[id] = wrapper
	}
	s.conns = make(map[string]*ssh.ClientWrapper)
	s.mu.Unlock()
	var closeErr error
	for id, wrapper := range connections {
		if err := wrapper.Close(); err != nil {
			closeErr = errors.Join(closeErr, fmt.Errorf("close connection %s: %w", id, err))
		}
	}
	return closeErr
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
	s.logger.Info("using password authentication")
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
	defer func() { _ = sock.Close() }()
	signers, err := agentClient.Signers()
	if err != nil {
		return nil, fmt.Errorf("ssh agent signers: %w", err)
	}
	return []gossh.AuthMethod{gossh.PublicKeys(signers...)}, nil
}

func generateTerminalID() string {
	return "term-" + uuid.NewString()
}

func generateConnectionAttemptID() string {
	return "connect-" + uuid.NewString()
}
