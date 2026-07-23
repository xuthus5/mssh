package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/localshell"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

// OpenLocal opens a terminal attached to a local interactive shell.
func (t *TerminalService) OpenLocal(ctx context.Context, cols, rows int) (string, error) {
	_ = ctx
	if err := validateTerminalSize(cols, rows); err != nil {
		return "", err
	}
	outcome := "failed"
	defer func() {
		if t.sessionSvc != nil {
			recordAudit(t.sessionSvc.db, t.logger, model.AuditEvent{
				Action: "connect", TargetType: "local_shell", TargetID: "local",
				Summary: "本地终端连接", Outcome: outcome,
			})
		}
	}()
	opts, err := t.localShellOptions(cols, rows)
	if err != nil {
		return "", err
	}
	session, err := localshell.Open(opts)
	if err != nil {
		t.logger.Error("local shell open failed", "error", err)
		return "", fmt.Errorf("local shell open: %w", err)
	}
	terminalID := uuid.New().String()
	t.registerTerminal(terminalID, "", session)
	t.logger.Info("local shell terminal opened", "terminalID", terminalID, "shell", opts.Shell)
	outcome = "success"
	return terminalID, nil
}

func (t *TerminalService) localShellOptions(cols, rows int) (localshell.Options, error) {
	opts := localshell.Options{
		Cols:  cols,
		Rows:  rows,
		Login: true,
		Term:  "xterm-256color",
	}
	if t.sessionSvc == nil || t.sessionSvc.db == nil {
		return opts, nil
	}
	db := t.sessionSvc.db
	if value, ok := readSettingString(db, "terminal.local_shell"); ok {
		opts.Shell = value
	}
	if value, ok := readSettingString(db, "terminal.local_shell_args"); ok {
		opts.Args = localshell.ParseArgs(value)
	}
	if value, ok := readSettingString(db, "terminal.local_shell_cwd"); ok {
		opts.CWD = value
	}
	if value, ok := readSettingBool(db, "terminal.local_shell_login"); ok {
		opts.Login = value
	}
	if value, ok := readSettingString(db, "terminal.default_term_type"); ok && value != "" {
		opts.Term = value
	}
	return opts, nil
}

func readSettingString(db *sql.DB, key string) (string, bool) {
	entry, err := store.GetSettingEntry(db, key)
	if err != nil || entry == nil {
		return "", false
	}
	var value string
	if err := json.Unmarshal([]byte(entry.Value), &value); err != nil {
		value = strings.TrimSpace(strings.Trim(entry.Value, `"`))
	} else {
		value = strings.TrimSpace(value)
	}
	return value, true
}

func readSettingBool(db *sql.DB, key string) (bool, bool) {
	entry, err := store.GetSettingEntry(db, key)
	if err != nil || entry == nil {
		return false, false
	}
	var value bool
	if err := json.Unmarshal([]byte(entry.Value), &value); err == nil {
		return value, true
	}
	raw := strings.TrimSpace(strings.Trim(entry.Value, `"`))
	switch raw {
	case "true", "1":
		return true, true
	case "false", "0":
		return false, true
	default:
		return false, false
	}
}
