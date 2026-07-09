package service

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
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
}

func NewSessionService(db *sql.DB, eventBus EventBus, keepAlive int) *SessionService {
	return &SessionService{
		db:        db,
		conns:     make(map[string]*ssh.ClientWrapper),
		eventBus:  eventBus,
		keepAlive: keepAlive,
	}
}

func (s *SessionService) ListFolders() ([]model.SessionFolder, error) {
	return store.ListFolders(s.db)
}

func (s *SessionService) CreateFolder(name string, parentID *int64) (*model.SessionFolder, error) {
	return store.CreateFolder(s.db, name, parentID)
}

func (s *SessionService) UpdateFolder(id int64, name string) error {
	return store.UpdateFolder(s.db, id, name)
}

func (s *SessionService) DeleteFolder(id int64) error {
	return store.DeleteFolder(s.db, id)
}

func (s *SessionService) MoveFolder(id int64, newParentID *int64) error {
	return store.MoveFolder(s.db, id, newParentID)
}

func (s *SessionService) ListSessions(folderID *int64) ([]model.Session, error) {
	return store.ListSessions(s.db, folderID)
}

func (s *SessionService) CreateSession(session model.Session) (*model.Session, error) {
	return store.CreateSession(s.db, session)
}

func (s *SessionService) UpdateSession(session model.Session) error {
	return store.UpdateSession(s.db, session)
}

func (s *SessionService) DeleteSession(id int64) error {
	return store.DeleteSession(s.db, id)
}

func (s *SessionService) MoveSession(id int64, newFolderID *int64) error {
	return store.MoveSession(s.db, id, newFolderID)
}

func (s *SessionService) GetSession(id int64) (*model.Session, error) {
	return store.GetSession(s.db, id)
}

func (s *SessionService) Connect(ctx context.Context, sessionID int64) (string, error) {
	sess, err := store.GetSession(s.db, sessionID)
	if err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}

	authMethods := s.buildAuthMethods(sess)

	wrapper, err := ssh.Connect(ctx, *sess, authMethods)
	if err != nil {
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

	return terminalID, nil
}

func (s *SessionService) Disconnect(terminalID string) error {
	s.mu.Lock()
	wrapper, ok := s.conns[terminalID]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	delete(s.conns, terminalID)
	s.mu.Unlock()

	_ = wrapper.Close()

	s.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{
		TerminalID: terminalID,
		State:      "disconnected",
	})

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
