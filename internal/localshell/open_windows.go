//go:build windows

package localshell

import (
	"context"
	"fmt"
	"strings"

	"github.com/UserExistsError/conpty"
)

func openPlatform(cfg resolvedConfig) (*Session, error) {
	commandLine := quoteWindowsCommand(cfg.Shell, cfg.Args)
	options := []conpty.ConPtyOption{
		conpty.ConPtyDimensions(cfg.Cols, cfg.Rows),
	}
	if cfg.CWD != "" {
		options = append(options, conpty.ConPtyWorkDir(cfg.CWD))
	}
	if len(cfg.Env) > 0 {
		options = append(options, conpty.ConPtyEnv(cfg.Env))
	}
	cpty, err := conpty.Start(commandLine, options...)
	if err != nil {
		return nil, fmt.Errorf("start local shell: %w", err)
	}
	waitCtx, cancel := context.WithCancel(context.Background())
	session := &Session{
		pty: cpty,
		processWait: func() error {
			code, err := cpty.Wait(waitCtx)
			if err != nil {
				return err
			}
			if code != 0 {
				return fmt.Errorf("local shell exited with code %d", code)
			}
			return nil
		},
		resizeFn: func(cols, rows int) error {
			return cpty.Resize(cols, rows)
		},
		closeFn: func() error {
			cancel()
			return cpty.Close()
		},
	}
	return session, nil
}

func quoteWindowsCommand(shell string, args []string) string {
	parts := make([]string, 0, 1+len(args))
	parts = append(parts, quoteWindowsArg(shell))
	for _, arg := range args {
		parts = append(parts, quoteWindowsArg(arg))
	}
	return strings.Join(parts, " ")
}

func quoteWindowsArg(arg string) string {
	if arg == "" {
		return `""`
	}
	if !strings.ContainsAny(arg, " \t\"") {
		return arg
	}
	var b strings.Builder
	b.WriteByte('"')
	for i := 0; i < len(arg); i++ {
		if arg[i] == '"' {
			b.WriteByte('\\')
		}
		b.WriteByte(arg[i])
	}
	b.WriteByte('"')
	return b.String()
}
