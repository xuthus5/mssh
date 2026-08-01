package service

import (
	"encoding/json"
	"log/slog"

	msshssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
)

const sftpFollowTerminalDirectorySettingKey = "sftp.follow_terminal_directory"

func (t *TerminalService) startTerminalDirectoryIntegration(
	sessionID int64,
	wrapper *msshssh.ClientWrapper,
) bool {
	if !t.terminalDirectoryIntegrationEnabled() || wrapper == nil {
		return false
	}
	t.terminalDirectoryIntegrationWG.Add(1)
	go func() {
		defer t.terminalDirectoryIntegrationWG.Done()
		t.runTerminalDirectoryIntegration(sessionID, wrapper)
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

func (t *TerminalService) runTerminalDirectoryIntegration(
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

func terminalServiceLogger(service *TerminalService) *slog.Logger {
	if service == nil || service.logger == nil {
		return slog.Default()
	}
	return service.logger
}
