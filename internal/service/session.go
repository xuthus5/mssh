package service

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"path/filepath"
	"sync"

	"github.com/google/uuid"
	gossh "golang.org/x/crypto/ssh"

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
	wrapper        *ssh.ClientWrapper
	cleanup        func()
	sessionID      int64
	closeMu        sync.Mutex
	cleanupOnce    sync.Once
	closeAttempted bool
	closed         bool
}

type sessionDeletionState struct {
	active     int
	generation uint64
}

// PasswordVerifier confirms the application password for step-up actions.
type PasswordVerifier interface {
	VerifyPassword(password string) error
}

type SessionService struct {
	db           *sql.DB
	mu           sync.RWMutex
	closeMu      sync.Mutex
	conns        map[string]*managedConn
	attempts     map[string]*connectAttempt
	deletions    map[int64]sessionDeletionState
	connectWG    sync.WaitGroup
	lifecycle    serviceOperationGate
	closing      bool
	shuttingDown bool
	eventBus     EventBus
	keepAlive    int
	dataDir      string
	crypto       KeyCrypto
	logger       *slog.Logger
	passwords    PasswordVerifier
	tunnels      SessionTunnelStopper
	transfers    SessionTransferCanceller
	terminals    SessionTerminalCloser
}

type connectAttempt struct {
	cancel     context.CancelFunc
	decision   chan bool
	sessionID  int64
	generation uint64
}

func NewSessionService(db *sql.DB, eventBus EventBus, keepAlive int, dataDir string, crypto KeyCrypto, logger *slog.Logger) *SessionService {
	if keepAlive <= 0 {
		keepAlive = DefaultKeepAliveSeconds
	}
	return &SessionService{
		db:        db,
		conns:     make(map[string]*managedConn),
		attempts:  make(map[string]*connectAttempt),
		deletions: make(map[int64]sessionDeletionState),
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
	s.mu.RLock()
	conn, ok := s.conns[terminalID]
	s.mu.RUnlock()
	if !ok {
		s.logger.Error("disconnect failed", "terminalID", terminalID, "error", "terminal not found")
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	if err := conn.closeConnection(); err != nil {
		closeErr := fmt.Errorf("close SSH client: %w", err)
		s.logger.Error("terminal disconnect cleanup failed", "terminalID", terminalID, "error", closeErr)
		return closeErr
	}

	if !s.removeConnectionIfOwned(terminalID, conn) {
		return nil
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

func (s *SessionService) buildPasswordAuth(sess *model.Session) ([]gossh.AuthMethod, error) {
	s.logger.Info("using password authentication")
	methods := []gossh.AuthMethod{gossh.Password(sess.Password)}
	if sess.Password != "" {
		methods = append(methods, s.buildKeyboardInteractiveAuth(sess)...)
	}
	return methods, nil
}

func (s *SessionService) buildKeyAuth(sess *model.Session) ([]gossh.AuthMethod, error) {
	var methods []gossh.AuthMethod
	err := withCryptoOperation(s.crypto, func() error {
		var buildErr error
		methods, buildErr = s.buildKeyAuthUnlocked(sess)
		return buildErr
	})
	return methods, err
}

func (s *SessionService) buildKeyAuthUnlocked(sess *model.Session) ([]gossh.AuthMethod, error) {
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
	defer clear(keyData)
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

func (s *SessionService) buildAuthBundle(sess *model.Session) ([]gossh.AuthMethod, func(), error) {
	return s.buildAuthBundleContext(context.Background(), sess)
}

func (s *SessionService) buildAuthBundleContext(
	ctx context.Context,
	sess *model.Session,
) ([]gossh.AuthMethod, func(), error) {
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
		auth, err := openAgentAuthContext(ctx)
		if err != nil {
			return nil, nil, err
		}
		return []gossh.AuthMethod{gossh.PublicKeys(auth.signers...)}, auth.Close, nil
	default:
		return nil, nil, nil
	}
}

func (s *SessionService) openAIAgentConnection(ctx context.Context, sessionID int64) (*ssh.ClientWrapper, func(), error) {
	sess, err := s.sessionForConnect(sessionID)
	if err != nil {
		return nil, nil, err
	}
	if err = s.resolveKeepAlive(sess); err != nil {
		return nil, nil, err
	}
	auth, cleanup, err := s.buildAuthBundleContext(ctx, sess)
	if err != nil {
		return nil, nil, err
	}
	knownHostsPath := filepath.Join(s.dataDir, "known_hosts")
	acceptKnownTestHost := false
	if accepter, ok := s.eventBus.(hostKeyAutoAccepter); ok {
		acceptKnownTestHost = accepter.AutoAcceptHostKeys()
	}
	client, err := ssh.ConnectWithVerifier(ctx, *sess, auth, knownHostsPath, func(_, _, _ string) bool {
		return acceptKnownTestHost
	}, s.logger)
	if err != nil {
		if cleanup != nil {
			cleanup()
		}
		return nil, nil, err
	}
	return client, cleanup, nil
}

func generateTerminalID() string {
	return "term-" + uuid.NewString()
}

func generateConnectionAttemptID() string {
	return "connect-" + uuid.NewString()
}
