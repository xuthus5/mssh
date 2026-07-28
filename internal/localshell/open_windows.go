//go:build windows

package localshell

import (
	"context"
	"fmt"

	"github.com/UserExistsError/conpty"
	"golang.org/x/sys/windows"
)

func openPlatformContext(ctx context.Context, cfg resolvedConfig) (*Session, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	commandLine := composeWindowsCommandLine(cfg.Shell, cfg.Args)
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
	if err := ctx.Err(); err != nil {
		_ = cpty.Close()
		return nil, err
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

func composeWindowsCommandLine(shell string, args []string) string {
	commandArgs := make([]string, 1, len(args)+1)
	commandArgs[0] = shell
	commandArgs = append(commandArgs, args...)
	return windows.ComposeCommandLine(commandArgs)
}
