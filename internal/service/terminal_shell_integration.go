package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	msshssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
)

const sftpFollowTerminalDirectorySettingKey = "sftp.follow_terminal_directory"

func (t *TerminalService) startTerminalDirectoryIntegration(sessionID int64) bool {
	if !t.terminalDirectoryIntegrationEnabled() {
		return false
	}
	t.terminalDirectoryIntegrationWG.Add(1)
	go func() {
		defer t.terminalDirectoryIntegrationWG.Done()
		t.runTerminalDirectoryIntegration(sessionID)
	}()
	return true
}

func (t *TerminalService) terminalDirectoryIntegrationEnabled() bool {
	logger := terminalServiceLogger(t)
	if t == nil || t.sessionSvc == nil || t.sessionSvc.db == nil {
		return false
	}
	setting, err := store.GetSettingEntry(t.sessionSvc.db, sftpFollowTerminalDirectorySettingKey)
	if err != nil {
		logger.Warn("load SFTP follow terminal directory setting failed", "error", err)
		return false
	}
	if setting == nil {
		return false
	}
	var enabled bool
	if err = json.Unmarshal([]byte(setting.Value), &enabled); err != nil {
		logger.Warn("parse SFTP follow terminal directory setting failed", "error", err)
		return false
	}
	return enabled
}

// runTerminalDirectoryIntegration performs shell detection and OSC 7 injection
// on a dedicated SSH connection, so deadlines or failures of the integration
// never affect the terminal's live connection.
func (t *TerminalService) runTerminalDirectoryIntegration(sessionID int64) {
	logger := terminalServiceLogger(t)
	ctx := context.Background()
	if t != nil && t.lifecycleContext != nil {
		ctx = t.lifecycleContext
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	wrapper, disconnect, err := t.openTerminalDirectoryIntegrationConnection(ctx, sessionID)
	if err != nil {
		logger.Warn("terminal directory integration connection failed",
			"sessionID", sessionID, "error", err)
		return
	}
	defer disconnect()
	t.runTerminalDirectoryIntegrationWithWrapper(sessionID, wrapper)
}

func (t *TerminalService) runTerminalDirectoryIntegrationWithWrapper(
	sessionID int64,
	wrapper *msshssh.ClientWrapper,
) {
	logger := terminalServiceLogger(t)
	shell, ok, err := _detectTerminalShellIntegration(wrapper)
	if err != nil {
		logger.Warn("terminal directory integration shell detection failed",
			"sessionID", sessionID, "error", err)
		return
	}
	if !ok {
		logger.Debug("terminal directory integration skipped unsupported shell",
			"sessionID", sessionID)
		return
	}
	remotePath, managed, err := _installTerminalDirectoryIntegrationForWrapper(wrapper, shell)
	if err != nil {
		logger.Warn("terminal directory integration install failed",
			"sessionID", sessionID, "shell", shell, "error", err)
		return
	}
	if managed {
		logger.Info("terminal directory integration installed",
			"sessionID", sessionID, "shell", shell, "path", remotePath)
	}
}

// openTerminalDirectoryIntegrationConnection establishes a temporary SSH
// connection used only for shell integration work. The returned disconnect
// closes the temporary connection exactly once.
func (t *TerminalService) openTerminalDirectoryIntegrationConnection(
	ctx context.Context,
	sessionID int64,
) (*msshssh.ClientWrapper, func(), error) {
	if t == nil || t.sessionSvc == nil {
		return nil, nil, errors.New("session service unavailable")
	}
	connID, err := t.sessionSvc.connect(ctx, sessionID, false)
	if err != nil {
		return nil, nil, err
	}
	wrapper, err := t.sessionSvc.GetClientWrapper(connID)
	if err != nil {
		_ = t.sessionSvc.disconnect(connID, false)
		return nil, nil, err
	}
	var once sync.Once
	disconnect := func() { once.Do(func() { _ = t.sessionSvc.disconnect(connID, false) }) }
	return wrapper, disconnect, nil
}

func terminalServiceLogger(service *TerminalService) *slog.Logger {
	if service == nil || service.logger == nil {
		return slog.Default()
	}
	return service.logger
}
