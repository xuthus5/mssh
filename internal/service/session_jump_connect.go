package service

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/pkg/event"
)

type sessionDialOptions struct {
	attemptID string
	hostKeys  ssh.HostKeyOptions
	jumpKeys  *ssh.HostKeyOptions
}

type sessionAuthenticatedDial struct {
	auth     []gossh.AuthMethod
	hostKeys ssh.HostKeyOptions
	jump     *ssh.ClientWrapper
}

func (s *SessionService) connectSessionTransport(ctx context.Context, session *model.Session, attemptID string) (*ssh.ClientWrapper, func(), error) {
	if session.JumpHost != nil {
		ctx = context.WithValue(ctx, jumpHostRouteContextKey{}, true)
	}
	return s.dialSessionTransport(ctx, session, sessionDialOptions{attemptID: attemptID, hostKeys: s.sessionHostKeyOptions(ctx, attemptID)})
}

func (s *SessionService) dialSessionTransport(ctx context.Context, session *model.Session, options sessionDialOptions) (*ssh.ClientWrapper, func(), error) {
	if strings.TrimSpace(s.dataDir) == "" {
		return nil, nil, fmt.Errorf("application data directory is required for host key verification")
	}
	var jump *ssh.ClientWrapper
	var jumpCleanup func()
	var err error
	if session.JumpHost != nil {
		jump, jumpCleanup, err = s.openJumpHost(ctx, session, options.jumpKeys)
		if err != nil {
			return nil, nil, fmt.Errorf("SSH jump host: %w", err)
		}
	}
	s.emitConnectionProgress(ctx, options.attemptID, "target")
	auth, cleanup, err := s.buildAuthBundleContext(ctx, session)
	cleanup = combineAuthCleanup(cleanup, jumpCleanup)
	if err != nil {
		return nil, nil, errors.Join(fmt.Errorf("target authentication: %w", err), closeRejectedConnection(jump, cleanup))
	}
	client, err := s.dialAuthenticatedSession(ctx, session, sessionAuthenticatedDial{auth: auth, hostKeys: options.hostKeys, jump: jump})
	if err != nil {
		if cleanup != nil {
			cleanup()
		}
		return nil, nil, err
	}
	return client, cleanup, nil
}

func (s *SessionService) dialAuthenticatedSession(ctx context.Context, session *model.Session, options sessionAuthenticatedDial) (*ssh.ClientWrapper, error) {
	knownHostsPath := filepath.Join(s.dataDir, "known_hosts")
	if options.jump == nil {
		return ssh.ConnectWithHostKeyOptions(ctx, *session, options.auth, knownHostsPath, options.hostKeys, s.logger)
	}
	return ssh.ConnectViaJumpHost(ctx, *session, ssh.JumpHostConnectOptions{
		JumpHost: options.jump, Auth: options.auth, KnownHostsPath: knownHostsPath, HostKey: options.hostKeys, Logger: s.logger,
	})
}

func (s *SessionService) openJumpHost(ctx context.Context, target *model.Session, override *ssh.HostKeyOptions) (*ssh.ClientWrapper, func(), error) {
	if strings.TrimSpace(s.dataDir) == "" {
		return nil, nil, fmt.Errorf("application data directory is required for host key verification")
	}
	jump := target.JumpHost
	if jump == nil {
		return nil, nil, fmt.Errorf("SSH jump host configuration is required")
	}
	if err := validateSSHJumpHost(jump); err != nil {
		return nil, nil, err
	}
	jumpContext, attemptID, _, finish, err := s.beginConnect(ctx, target.ID)
	if err != nil {
		return nil, nil, err
	}
	defer finish()
	jumpContext = context.WithValue(jumpContext, jumpHostVerificationContextKey{}, true)
	s.eventBus.Emit(event.ConnectionAttempt, event.ConnectionStatePayload{AttemptID: attemptID, State: "connecting"})
	s.emitConnectionProgress(jumpContext, attemptID, "jump")
	session := &model.Session{Host: jump.Host, Port: jump.Port, Username: jump.Username, AuthMethod: jump.AuthMethod, Password: jump.Password, KeyID: jump.KeyID, KeepAlive: target.KeepAlive}
	auth, cleanup, err := s.buildAuthBundleContext(jumpContext, session)
	if err != nil {
		return nil, nil, err
	}
	hostKeys := s.sessionHostKeyOptions(jumpContext, attemptID)
	if override != nil {
		hostKeys = *override
	}
	client, err := ssh.ConnectWithHostKeyOptions(jumpContext, *session, auth, filepath.Join(s.dataDir, "known_hosts"), hostKeys, s.logger)
	if err != nil {
		if cleanup != nil {
			cleanup()
		}
		return nil, nil, err
	}
	return client, cleanup, nil
}

func (s *SessionService) sessionHostKeyOptions(ctx context.Context, attemptID string) ssh.HostKeyOptions {
	return ssh.HostKeyOptions{
		Policy: s.hostKeyChangePolicy(),
		OnNewHostKey: func(hostname, algorithm, fingerprint string) bool {
			return s.awaitHostKeyDecision(ctx, attemptID, hostname, algorithm, fingerprint, false, nil)
		},
		OnHostKeyChange: func(hostname, algorithm, fingerprint string, expected []string) bool {
			return s.awaitHostKeyDecision(ctx, attemptID, hostname, algorithm, fingerprint, true, expected)
		},
	}
}

func combineAuthCleanup(first, second func()) func() {
	if first == nil && second == nil {
		return nil
	}
	return func() {
		if first != nil {
			first()
		}
		if second != nil {
			second()
		}
	}
}
