package service

import (
	"context"
	"errors"
	"fmt"

	ssh "github.com/xuthus5/mssh/internal/ssh"
)

func (t *TerminalService) cleanupTerminalResources(connID string, pty terminalIO) error {
	var cleanupErr error
	if pty != nil {
		if err := pty.Close(); err != nil {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("close terminal IO: %w", err))
		}
	}
	if t.sessionSvc != nil && connID != "" {
		if err := t.sessionSvc.disconnect(connID, false); err != nil {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("disconnect terminal connection: %w", err))
		}
	}
	return cleanupErr
}

type preparedTerminalConnection struct {
	connID         string
	wrapper        *ssh.ClientWrapper
	termType       string
	startupCommand string
}

func (t *TerminalService) prepareTerminalConnection(ctx context.Context, sessionID int64) (*preparedTerminalConnection, error) {
	connID, err := t.sessionSvc.connect(ctx, sessionID, false)
	if err != nil {
		return nil, err
	}
	wrapper, err := t.sessionSvc.GetClientWrapper(connID)
	if err != nil {
		return nil, errors.Join(err, t.cleanupTerminalResources(connID, nil))
	}
	sess, err := t.sessionSvc.GetSession(sessionID)
	if err != nil {
		return nil, errors.Join(err, t.cleanupTerminalResources(connID, nil))
	}
	termType := sess.TermType
	if termType == "" {
		termType = "xterm-256color"
	}
	return &preparedTerminalConnection{connID: connID, wrapper: wrapper, termType: termType, startupCommand: sess.StartupCommand}, nil
}
