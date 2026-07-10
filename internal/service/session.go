package service

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"log/slog"
	"sync"

	gossh "golang.org/x/crypto/ssh"

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
	eventBus  EventBus
	keepAlive int
	logger    *slog.Logger
}

func NewSessionService(db *sql.DB, eventBus EventBus, keepAlive int, logger *slog.Logger) *SessionService {
	return &SessionService{
		db:        db,
		conns:     make(map[string]*ssh.ClientWrapper),
		eventBus:  eventBus,
		keepAlive: keepAlive,
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
	s.logger.Info("creating session", "name", session.Name, "authMethod", session.AuthMethod)
	result, err := store.CreateSession(s.db, session)
	if err != nil {
		s.logger.Error("create session failed", "error", err)
	}
	return result, err
}

func (s *SessionService) UpdateSession(session model.Session) error {
	s.logger.Info("updating session", "id", session.ID, "name", session.Name)
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
	sess, err := store.GetSession(s.db, sessionID)
	if err != nil {
		s.logger.Error("connect failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("connect: %w", err)
	}

	authMethods := s.buildAuthMethods(sess)

	wrapper, err := ssh.Connect(ctx, *sess, authMethods)
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
		State:      "connected",
	})

	s.logger.Info("connected to session", "sessionID", sessionID, "terminalID", terminalID)
	return terminalID, nil
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

func (s *SessionService) buildAuthMethods(sess *model.Session) []gossh.AuthMethod {
	var methods []gossh.AuthMethod

	switch sess.AuthMethod {
	case model.AuthPassword:
		methods = append(methods, gossh.Password(sess.Password))
	case model.AuthKey:
		if sess.KeyID != nil {
			key, err := store.GetKey(s.db, *sess.KeyID)
			if err == nil {
				if signer, signErr := gossh.ParsePrivateKey([]byte(key.PrivateKey)); signErr == nil {
					methods = append(methods, gossh.PublicKeys(signer))
				}
			}
		}
	case model.AuthKeyboardInteractive:
		methods = append(methods, gossh.KeyboardInteractive(
			func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range answers {
					answers[i] = sess.Password
				}
				return answers, nil
			},
		))
	}

	return methods
}

func generateTerminalID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("term-%x", b)
}
