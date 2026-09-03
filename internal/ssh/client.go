package ssh

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strconv"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
)

const sshConnectTimeout = 10 * time.Second

// HostKeyPolicy controls how host key verification reacts to changed or
// unknown fingerprints during connection.
type HostKeyPolicy int

const (
	// HostKeyPolicyBlock rejects connections when a known host's fingerprint
	// changes and prompts for unknown hosts. This is the default.
	HostKeyPolicyBlock HostKeyPolicy = iota
	// HostKeyPolicyWarn prompts the user with old and new fingerprints when a
	// known host's fingerprint changes, and prompts for unknown hosts.
	HostKeyPolicyWarn
	// HostKeyPolicyTrust automatically trusts changed and unknown fingerprints.
	HostKeyPolicyTrust
)

// HostKeyVerifyFunc is invoked when an unknown host key is encountered.
// It receives the hostname, algorithm, and Base64 fingerprint of the key.
// Returning true accepts and persists the key; returning false rejects the
// connection. A nil callback rejects unknown keys unless PolicyTrust is set.
type HostKeyVerifyFunc func(hostname, algorithm, fingerprint string) bool

// HostKeyChangedVerifyFunc is invoked when a known host's fingerprint
// changes. It receives the hostname, algorithm, new fingerprint, and the list
// of expected (previously trusted) fingerprints. Returning true accepts and
// replaces the stored key; returning false rejects the connection.
type HostKeyChangedVerifyFunc func(hostname, algorithm, fingerprint string, expected []string) bool

// HostKeyOptions configures host key verification during connection.
type HostKeyOptions struct {
	Policy          HostKeyPolicy
	OnNewHostKey    HostKeyVerifyFunc
	OnHostKeyChange HostKeyChangedVerifyFunc
}

// ClientWrapper wraps an SSH client with keep-alive lifecycle management.
type ClientWrapper struct {
	Inner           *gossh.Client
	transport       net.Conn
	keepAliveCtx    context.Context
	keepAliveCancel context.CancelFunc
	keepAliveWG     sync.WaitGroup
	connectionWG    sync.WaitGroup
	closeOnce       sync.Once
	doneOnce        sync.Once
	done            chan struct{}
	closeErr        error
}

// Connect establishes an SSH connection to the given session host.
// knownHostsPath is required; host key verification is enforced using
// the known_hosts file at that path (TOFU for first-seen keys).
func Connect(ctx context.Context, session model.Session, auth []gossh.AuthMethod, knownHostsPath string, logger *slog.Logger) (*ClientWrapper, error) {
	return ConnectWithHostKeyOptions(ctx, session, auth, knownHostsPath, HostKeyOptions{Policy: HostKeyPolicyTrust}, logger)
}

// ConnectWithVerifier is like Connect but accepts a host key verification
// callback invoked for first-seen host keys.
func ConnectWithVerifier(ctx context.Context, session model.Session, auth []gossh.AuthMethod, knownHostsPath string, onNewHostKey HostKeyVerifyFunc, logger *slog.Logger) (*ClientWrapper, error) {
	return ConnectWithHostKeyOptions(ctx, session, auth, knownHostsPath, HostKeyOptions{
		Policy:       HostKeyPolicyBlock,
		OnNewHostKey: onNewHostKey,
	}, logger)
}

// ConnectWithHostKeyOptions is like ConnectWithVerifier but allows configuring
// the host key change policy and a callback for changed fingerprints.
func ConnectWithHostKeyOptions(ctx context.Context, session model.Session, auth []gossh.AuthMethod, knownHostsPath string, options HostKeyOptions, logger *slog.Logger) (*ClientWrapper, error) {
	if logger == nil {
		logger = slog.Default()
	}
	logger.Info("connecting to SSH server", "host", session.Host, "port", session.Port, "user", session.Username, "authCount", len(auth))
	hostKeyCallback, err := createHostKeyCallback(knownHostsPath, options, logger)
	if err != nil {
		logger.Error("host key callback creation failed", "error", err)
		return nil, fmt.Errorf("host key callback: %w", err)
	}
	config := &gossh.ClientConfig{
		User:            session.Username,
		Auth:            auth,
		HostKeyCallback: hostKeyCallback,
		Timeout:         sshConnectTimeout,
	}
	addr := net.JoinHostPort(session.Host, strconv.Itoa(session.Port))
	dialer := &net.Dialer{Timeout: sshConnectTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		logger.Error("dial failed", "addr", addr, "error", err)
		return nil, fmt.Errorf("dial %s: %w", addr, err)
	}
	sshConn, channels, requests, err := establishSSHConnection(ctx, conn, addr, config)
	if err != nil {
		logger.Error("SSH handshake failed", "addr", addr, "error", err)
		return nil, fmt.Errorf("ssh handshake: %w", err)
	}
	client := gossh.NewClient(sshConn, channels, requests)
	wrapper := newClientWrapper(client, conn)
	interval := time.Duration(session.KeepAlive) * time.Second
	if interval <= 0 {
		interval = 30 * time.Second
	}
	wrapper.keepAliveWG.Add(1)
	go func() {
		defer wrapper.keepAliveWG.Done()
		wrapper.startKeepAlive(interval, logger)
	}()
	logger.Info("SSH connection established", "host", session.Host, "port", session.Port)
	return wrapper, nil
}

func establishSSHConnection(
	ctx context.Context,
	conn net.Conn,
	addr string,
	config *gossh.ClientConfig,
) (gossh.Conn, <-chan gossh.NewChannel, <-chan *gossh.Request, error) {
	deadline := time.Now().Add(sshConnectTimeout)
	contextDeadline, contextDeadlineApplied := ctx.Deadline()
	if contextDeadlineApplied && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	} else {
		contextDeadlineApplied = false
	}
	if err := conn.SetDeadline(deadline); err != nil {
		_ = conn.Close()
		return nil, nil, nil, fmt.Errorf("set handshake deadline: %w", err)
	}
	stopCancellation := context.AfterFunc(ctx, func() { _ = conn.Close() })
	sshConn, channels, requests, err := gossh.NewClientConn(conn, addr, config)
	stopCancellation()
	if err != nil {
		_ = conn.Close()
		return nil, nil, nil, normalizeHandshakeError(
			ctx, err, contextDeadline, contextDeadlineApplied,
		)
	}
	if contextErr := ctx.Err(); contextErr != nil {
		_ = sshConn.Close()
		return nil, nil, nil, contextErr
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		_ = sshConn.Close()
		return nil, nil, nil, fmt.Errorf("clear handshake deadline: %w", err)
	}
	return sshConn, channels, requests, nil
}

func normalizeHandshakeError(
	ctx context.Context,
	err error,
	contextDeadline time.Time,
	contextDeadlineApplied bool,
) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	var networkError net.Error
	if contextDeadlineApplied && !time.Now().Before(contextDeadline) &&
		errors.As(err, &networkError) && networkError.Timeout() {
		return context.DeadlineExceeded
	}
	return err
}

// SetDeadline applies an I/O deadline to the underlying SSH transport.
func (c *ClientWrapper) SetDeadline(deadline time.Time) error {
	if c == nil || c.transport == nil {
		return fmt.Errorf("SSH transport is unavailable")
	}
	return c.transport.SetDeadline(deadline)
}

// Close stops keep-alive and closes the underlying SSH connection.
func (c *ClientWrapper) Close() error {
	if c == nil {
		return nil
	}
	closeErr := c.closeConnection()
	c.keepAliveWG.Wait()
	c.connectionWG.Wait()
	return closeErr
}

func (c *ClientWrapper) closeConnection() error {
	if c == nil {
		return nil
	}
	c.closeOnce.Do(func() {
		if c.keepAliveCancel != nil {
			c.keepAliveCancel()
		}
		if c.Inner != nil {
			c.closeErr = c.Inner.Close()
		}
		c.signalDone()
	})
	return c.closeErr
}
