package ssh

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"mssh/internal/model"
)

type ClientWrapper struct {
	Inner           *gossh.Client
	keepAliveCtx    context.Context
	keepAliveCancel context.CancelFunc
}

func Connect(ctx context.Context, s model.Session, auth []gossh.AuthMethod, knownHostsPath string, logger *slog.Logger) (*ClientWrapper, error) {
	if logger == nil {
		logger = slog.Default()
	}

	logger.Info("connecting to SSH server", "host", s.Host, "port", s.Port, "user", s.Username, "authCount", len(auth))

	hostKeyCallback, err := createHostKeyCallback(knownHostsPath)
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
	addr := fmt.Sprintf("%s:%d", s.Host, s.Port)
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		logger.Error("dial failed", "addr", addr, "error", err)
		return nil, fmt.Errorf("dial %s: %w", addr, err)
	}
	sshConn, chans, reqs, err := gossh.NewClientConn(conn, addr, config)
	if err != nil {
		conn.Close()
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

func (c *ClientWrapper) Close() error {
	c.keepAliveCancel()
	return c.Inner.Close()
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

func createHostKeyCallback(knownHostsPath string) (gossh.HostKeyCallback, error) {
	if knownHostsPath == "" {
		return gossh.InsecureIgnoreHostKey(), nil
	}

	if _, err := os.Stat(knownHostsPath); os.IsNotExist(err) {
		dir := filepath.Dir(knownHostsPath)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, fmt.Errorf("create known_hosts dir: %w", err)
		}
		f, err := os.OpenFile(knownHostsPath, os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			return nil, fmt.Errorf("create known_hosts: %w", err)
		}
		_ = f.Close()
	}

	baseCb, err := knownhosts.New(knownHostsPath)
	if err != nil {
		return nil, fmt.Errorf("parse known_hosts: %w", err)
	}

	return func(hostname string, remote net.Addr, key gossh.PublicKey) error {
		err := baseCb(hostname, remote, key)
		if err == nil {
			return nil
		}
		var keyErr *knownhosts.KeyError
		if errors.As(err, &keyErr) && len(keyErr.Want) == 0 {
			entry := knownhosts.Line([]string{hostname}, key)
			f, fErr := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
			if fErr != nil {
				return fErr
			}
			defer f.Close()
			_, wErr := fmt.Fprintln(f, entry)
			return wErr
		}
		return err
	}, nil
}

func tryNativeSSH(host string, port int, user, password string) error {
	_, err := exec.LookPath("ssh")
	if err != nil {
		return fmt.Errorf("ssh command not found: %w", err)
	}
	// Use sshpass if available, otherwise pipe password
	if _, err := exec.LookPath("sshpass"); err == nil {
		cmd := exec.Command("sshpass", "-p", password,
			"ssh", "-o", "StrictHostKeyChecking=no",
			"-o", "UserKnownHostsFile=/dev/null",
			"-o", "PreferredAuthentications=password",
			"-o", "PubkeyAuthentication=no",
			"-o", "BatchMode=yes",
			"-p", fmt.Sprint(port),
			fmt.Sprintf("%s@%s", user, host),
			"exit")
		return cmd.Run()
	}
	// Fallback: pipe password via stdin
	cmd := exec.Command("ssh",
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
		"-o", "PreferredAuthentications=password",
		"-o", "PubkeyAuthentication=no",
		"-o", "BatchMode=yes",
		"-p", fmt.Sprint(port),
		fmt.Sprintf("%s@%s", user, host),
		"exit")
	cmd.Stdin = strings.NewReader(password + "\n")
	return cmd.Run()
}

// ConnectWithFallback attempts Go SSH connection first, falls back to native ssh
func ConnectWithFallback(ctx context.Context, s model.Session, auth []gossh.AuthMethod, knownHostsPath string, logger *slog.Logger) (*ClientWrapper, error) {
	cw, err := Connect(ctx, s, auth, knownHostsPath, logger)
	if err != nil && isAuthError(err) && s.AuthMethod == model.AuthPassword && s.Password != "" {
		logger.Warn("Go SSH password auth failed, trying native ssh", "host", s.Host, "port", s.Port)
		nativeErr := tryNativeSSH(s.Host, s.Port, s.Username, s.Password)
		if nativeErr != nil {
			logger.Error("native ssh also failed", "error", nativeErr)
			return nil, err
		}
		// Native ssh succeeded, but we can't return a ClientWrapper from it
		// Signal to caller that Go SSH failed but native ssh is available
		logger.Info("native ssh connection successful, but Go library is required for PTY")
	}
	return cw, err
}

func isAuthError(err error) bool {
	if err == nil {
		return false
	}
	return contains(err.Error(), "unable to authenticate")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
