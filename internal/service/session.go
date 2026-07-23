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

// hostKeyAutoAccepter is implemented by test event buses to accept TOFU without UI.
type hostKeyAutoAccepter interface {
	AutoAcceptHostKeys() bool
}

const DefaultKeepAliveSeconds = 60

type managedConn struct {
	wrapper *ssh.ClientWrapper
	cleanup func()
}

// PasswordVerifier confirms the application password for step-up actions.
type PasswordVerifier interface {
	VerifyPassword(password string) error
}

type SessionService struct {
	db        *sql.DB
	mu        sync.RWMutex
	conns     map[string]*managedConn
	attempts  map[string]*connectAttempt
	eventBus  EventBus
	keepAlive int
	dataDir   string
	crypto    KeyCrypto
	logger    *slog.Logger
	passwords PasswordVerifier
}

type connectAttempt struct {
	cancel   context.CancelFunc
	decision chan bool
}

func NewSessionService(db *sql.DB, eventBus EventBus, keepAlive int, dataDir string, crypto KeyCrypto, logger *slog.Logger) *SessionService {
	if keepAlive <= 0 {
		keepAlive = DefaultKeepAliveSeconds
	}
	return &SessionService{
		db:        db,
		conns:     make(map[string]*managedConn),
		attempts:  make(map[string]*connectAttempt),
		eventBus:  eventBus,
		keepAlive: keepAlive,
		dataDir:   dataDir,
		crypto:    crypto,
		logger:    logger,
	}
}

// SetPasswordVerifier wires step-up authentication for sensitive exports.
//
//wails:ignore
func (s *SessionService) SetPasswordVerifier(verifier PasswordVerifier) {
	s.passwords = verifier
}

func (s *SessionService) disconnect(terminalID string, emitState bool) error {
	s.logger.Info("disconnecting terminal", "terminalID", terminalID)
	s.mu.Lock()
	conn, ok := s.conns[terminalID]
	if !ok {
		s.mu.Unlock()
		s.logger.Error("disconnect failed", "terminalID", terminalID, "error", "terminal not found")
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	delete(s.conns, terminalID)
	s.mu.Unlock()

	if conn.cleanup != nil {
		conn.cleanup()
	}
	if conn.wrapper != nil {
		_ = conn.wrapper.Close()
	}

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
	conn, ok := s.conns[connID]
	if !ok || conn.wrapper == nil {
		return nil, fmt.Errorf("connection %s not found", connID)
	}
	return conn.wrapper, nil
}

func (s *SessionService) ConnectionCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.conns)
}

func (s *SessionService) CloseAll() error {
	s.mu.Lock()
	connections := make(map[string]*managedConn, len(s.conns))
	for id, conn := range s.conns {
		connections[id] = conn
	}
	s.conns = make(map[string]*managedConn)
	s.mu.Unlock()
	var closeErr error
	for id, conn := range connections {
		if conn.cleanup != nil {
			conn.cleanup()
		}
		if conn.wrapper != nil {
			if err := conn.wrapper.Close(); err != nil {
				closeErr = errors.Join(closeErr, fmt.Errorf("close connection %s: %w", id, err))
			}
		}
	}
	return closeErr
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

// agentAuth holds an open SSH agent socket for the full authentication handshake.
// The socket must remain open until SSH public-key signatures complete.
type agentAuth struct {
	sock    net.Conn
	signers []gossh.Signer
}

func (a *agentAuth) Close() {
	if a == nil || a.sock == nil {
		return
	}
	_ = a.sock.Close()
	a.sock = nil
}

func openAgentAuth() (*agentAuth, error) {
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
		_ = sock.Close()
		return nil, fmt.Errorf("ssh agent signers: %w", err)
	}
	if len(signers) == 0 {
		_ = sock.Close()
		return nil, fmt.Errorf("ssh agent: no signers available")
	}
	return &agentAuth{sock: sock, signers: signers}, nil
}

// buildAgentAuth is for tests/simple callers; the agent socket stays open for signer use.
// Prefer buildAuthBundle in production so disconnect can close the socket.
func (s *SessionService) buildAgentAuth() ([]gossh.AuthMethod, error) {
	methods, _, err := s.buildAuthBundle(&model.Session{AuthMethod: model.AuthAgent})
	return methods, err
}

func (s *SessionService) buildAuthBundle(sess *model.Session) ([]gossh.AuthMethod, func(), error) {
	switch sess.AuthMethod {
	case model.AuthPassword:
		methods, err := s.buildPasswordAuth(sess)
		return methods, nil, err
	case model.AuthKey:
		methods, err := s.buildKeyAuth(sess)
		return methods, nil, err
	case model.AuthKeyboardInteractive:
		return s.buildKeyboardInteractiveAuth(sess), nil, nil
	case model.AuthAgent:
		auth, err := openAgentAuth()
		if err != nil {
			return nil, nil, err
		}
		return []gossh.AuthMethod{gossh.PublicKeys(auth.signers...)}, auth.Close, nil
	default:
		return nil, nil, nil
	}
}

func (s *SessionService) buildAuthMethods(sess *model.Session) ([]gossh.AuthMethod, error) {
	methods, _, err := s.buildAuthBundle(sess)
	return methods, err
}

func generateTerminalID() string {
	return "term-" + uuid.NewString()
}

func generateConnectionAttemptID() string {
	return "connect-" + uuid.NewString()
}
