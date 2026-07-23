package ssh

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/xuthus5/mssh/internal/model"
)

// HostKeyVerifyFunc is invoked when an unknown host key is encountered.
// It receives the hostname, algorithm, and Base64 fingerprint of the key.
// Returning true accepts and persists the key; returning false rejects the
// connection. When nil, new keys are accepted automatically (TOFU) and the
// fingerprint is reported via the callback for informational display.
type HostKeyVerifyFunc func(hostname, algorithm, fingerprint string) bool

// ClientWrapper wraps an SSH client with keep-alive lifecycle management.
type ClientWrapper struct {
	Inner           *gossh.Client
	keepAliveCtx    context.Context
	keepAliveCancel context.CancelFunc
	closeOnce       sync.Once
	closeErr        error
}

// Connect establishes an SSH connection to the given session host.
// knownHostsPath is required; host key verification is enforced using
// the known_hosts file at that path (TOFU for first-seen keys). When empty,
// host key verification is skipped — this should only be used in tests.
// onNewHostKey, when non-nil, is called with the fingerprint of a first-seen
// host key so the caller can surface it to the user.
func Connect(ctx context.Context, s model.Session, auth []gossh.AuthMethod, knownHostsPath string, logger *slog.Logger) (*ClientWrapper, error) {
	return ConnectWithVerifier(ctx, s, auth, knownHostsPath, nil, logger)
}

// ConnectWithVerifier is like Connect but accepts a host key verification
// callback invoked for first-seen host keys.
func ConnectWithVerifier(ctx context.Context, s model.Session, auth []gossh.AuthMethod, knownHostsPath string, onNewHostKey HostKeyVerifyFunc, logger *slog.Logger) (*ClientWrapper, error) {
	if logger == nil {
		logger = slog.Default()
	}

	logger.Info("connecting to SSH server", "host", s.Host, "port", s.Port, "user", s.Username, "authCount", len(auth))

	hostKeyCallback, err := createHostKeyCallback(knownHostsPath, onNewHostKey, logger)
	if err != nil {
		logger.Error("host key callback creation failed", "error", err)
		return nil, fmt.Errorf("host key callback: %w", err)
	}

	config := &gossh.ClientConfig{
		User:            s.Username,
		Auth:            auth,
		HostKeyCallback: hostKeyCallback,
		Timeout:         10 * time.Second,
	}
	addr := net.JoinHostPort(s.Host, strconv.Itoa(s.Port))
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		logger.Error("dial failed", "addr", addr, "error", err)
		return nil, fmt.Errorf("dial %s: %w", addr, err)
	}
	sshConn, chans, reqs, err := gossh.NewClientConn(conn, addr, config)
	if err != nil {
		_ = conn.Close()
		logger.Error("SSH handshake failed", "addr", addr, "error", err)
		return nil, fmt.Errorf("ssh handshake: %w", err)
	}
	client := gossh.NewClient(sshConn, chans, reqs)
	kc, cancel := context.WithCancel(context.Background())
	cw := &ClientWrapper{Inner: client, keepAliveCtx: kc, keepAliveCancel: cancel}

	interval := time.Duration(s.KeepAlive) * time.Second
	if interval <= 0 {
		interval = 30 * time.Second
	}
	go cw.startKeepAlive(interval, logger)

	logger.Info("SSH connection established", "host", s.Host, "port", s.Port)
	return cw, nil
}

// Close stops keep-alive and closes the underlying SSH connection.
func (c *ClientWrapper) Close() error {
	c.closeOnce.Do(func() {
		if c.keepAliveCancel != nil {
			c.keepAliveCancel()
		}
		if c.Inner != nil {
			c.closeErr = c.Inner.Close()
		}
	})
	return c.closeErr
}

func (c *ClientWrapper) startKeepAlive(interval time.Duration, logger *slog.Logger) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	failCount := 0
	for {
		select {
		case <-ticker.C:
			_, _, err := c.Inner.SendRequest("keepalive@mssh", true, nil)
			if err != nil {
				failCount++
				logger.Warn("keep-alive failed", "error", err, "failCount", failCount)
				if failCount >= 3 {
					logger.Error("keep-alive max failures reached, closing connection")
					_ = c.Close()
					return
				}
			} else {
				failCount = 0
			}
		case <-c.keepAliveCtx.Done():
			return
		}
	}
}

// ErrEmptyKnownHostsPath is returned when host key verification is required
// but no known_hosts path was provided.
var ErrEmptyKnownHostsPath = errors.New("known_hosts path is required for host key verification")

// knownHostsMu serializes create/append/rewrite of the shared known_hosts file.
var knownHostsMu sync.Mutex

// WithKnownHostsLock runs fn while holding the process-wide known_hosts write lock.
// Use for any read-modify-write of the known_hosts file (accept TOFU, delete fingerprint).
func WithKnownHostsLock(fn func() error) error {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	return fn()
}

// createHostKeyCallback builds a host key callback. knownHostsPath is required;
// first-seen keys are accepted via TOFU and reported through onNewHostKey.
func createHostKeyCallback(knownHostsPath string, onNewHostKey HostKeyVerifyFunc, logger *slog.Logger) (gossh.HostKeyCallback, error) {
	if strings.TrimSpace(knownHostsPath) == "" {
		return nil, ErrEmptyKnownHostsPath
	}

	if err := ensureKnownHostsFile(knownHostsPath); err != nil {
		return nil, err
	}

	baseCb, err := knownhosts.New(knownHostsPath)
	if err != nil {
		return nil, fmt.Errorf("parse known_hosts: %w", err)
	}

	return func(hostname string, remote net.Addr, key gossh.PublicKey) error {
		return verifyHostKey(baseCb, hostname, remote, key, knownHostsPath, onNewHostKey, logger)
	}, nil
}

func ensureKnownHostsFile(knownHostsPath string) error {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	if _, err := os.Stat(knownHostsPath); !os.IsNotExist(err) {
		return nil
	}
	dir := filepath.Dir(knownHostsPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create known_hosts dir: %w", err)
	}
	f, err := os.OpenFile(knownHostsPath, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create known_hosts: %w", err)
	}
	_ = f.Close()
	return nil
}

func verifyHostKey(baseCb gossh.HostKeyCallback, hostname string, remote net.Addr, key gossh.PublicKey, knownHostsPath string, onNewHostKey HostKeyVerifyFunc, logger *slog.Logger) error {
	err := baseCb(hostname, remote, key)
	if err == nil {
		return nil
	}
	var keyErr *knownhosts.KeyError
	if !errors.As(err, &keyErr) {
		return err
	}
	// Want non-empty: known host key changed (possible MITM). Block and surface fingerprints.
	if len(keyErr.Want) != 0 {
		return hostKeyChangedError(hostname, key, keyErr)
	}
	return handleNewHostKey(hostname, key, knownHostsPath, onNewHostKey, logger)
}

// hostKeyChangedError builds a commercial, actionable mismatch error with expected vs presented fingerprints.
func hostKeyChangedError(hostname string, presented gossh.PublicKey, keyErr *knownhosts.KeyError) error {
	presentedFP := gossh.FingerprintSHA256(presented)
	expected := make([]string, 0, len(keyErr.Want))
	for _, known := range keyErr.Want {
		if known.Key == nil {
			continue
		}
		expected = append(expected, known.Key.Type()+" "+gossh.FingerprintSHA256(known.Key))
	}
	if len(expected) == 0 {
		return fmt.Errorf("host key for %s changed (presented %s %s); connection blocked. Remove the old fingerprint in Security settings if the change is expected",
			hostname, presented.Type(), presentedFP)
	}
	return fmt.Errorf("host key for %s changed (possible MITM). expected [%s]; presented %s %s. connection blocked. remove the old fingerprint in Security settings if the change is expected",
		hostname, strings.Join(expected, ", "), presented.Type(), presentedFP)
}

func handleNewHostKey(hostname string, key gossh.PublicKey, knownHostsPath string, onNewHostKey HostKeyVerifyFunc, logger *slog.Logger) error {
	algo := key.Type()
	fingerprint := gossh.FingerprintSHA256(key)
	if logger != nil {
		logger.Info("first-seen host key accepted via TOFU",
			"hostname", hostname, "algorithm", algo, "fingerprint", fingerprint)
	}
	if onNewHostKey != nil && !onNewHostKey(hostname, algo, fingerprint) {
		return fmt.Errorf("host key rejected by user: %s", hostname)
	}
	return appendKnownHost(knownHostsPath, hostname, key)
}

func appendKnownHost(knownHostsPath, hostname string, key gossh.PublicKey) error {
	entry := knownhosts.Line([]string{hostname}, key)
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	f, fErr := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if fErr != nil {
		return fErr
	}
	defer func() { _ = f.Close() }()
	if _, wErr := fmt.Fprintln(f, entry); wErr != nil {
		return wErr
	}
	return f.Sync()
}
