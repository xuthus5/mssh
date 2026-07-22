package app

import (
	"log/slog"

	"github.com/xuthus5/mssh/internal/service"
)

type terminalRecordingStopper interface {
	StopTerminalRecordingIfActive(terminalID string) error
}

type syncLifecycleAdapter struct {
	terminal *service.TerminalService
	tunnel   *service.TunnelService
	session  *service.SessionService
}

func (s syncLifecycleAdapter) PrepareDestructiveSync() error {
	if err := service.CloseAllTerminals(s.terminal); err != nil {
		return err
	}
	if s.tunnel != nil {
		s.tunnel.StopAll()
	}
	if s.session != nil {
		return s.session.CloseAll()
	}
	return nil
}

func configureTerminalLogging(terminalSvc *service.TerminalService, logSvc *service.LogService, logger *slog.Logger) {
	terminalSvc.SetOutputHandler(func(terminalID string, data []byte) { logSvc.HandleOutput(terminalID, data) })
	terminalSvc.SetCloseHandler(func(terminalID string) { handleTerminalRecordingClose(logSvc, logger, terminalID) })
}

func handleTerminalRecordingClose(stopper terminalRecordingStopper, logger *slog.Logger, terminalID string) {
	if err := stopper.StopTerminalRecordingIfActive(terminalID); err != nil {
		logger.Error("stop terminal recording on close failed", "terminalID", terminalID, "error", err)
	}
}

func (a *App) Shutdown() {
	a.shutdownOnce.Do(a.shutdown)
}

func (a *App) shutdown() {
	if a.Security != nil {
		a.Security.ClearMemory()
	}

	logger := a.logger
	if logger == nil {
		logger = slog.Default()
	}
	if err := service.CloseAllActiveRecordings(a.Log); err != nil {
		logger.Error("close active recordings during shutdown failed", "error", err)
	}
	if a.File != nil {
		a.File.CancelAll()
	}
	if a.Sync != nil {
		a.Sync.StopScheduler()
	}
	if a.Tunnel != nil {
		a.Tunnel.StopAll()
	}
	if a.Session != nil {
		if err := a.Session.CloseAll(); err != nil {
			logger.Error("close SSH connections during shutdown failed", "error", err)
		}
	}
	if a.DB != nil {
		if err := a.DB.Close(); err != nil {
			logger.Error("close database during shutdown failed", "error", err)
		}
	}
}

func DefaultTestLogger(t interface{ Logf(string, ...any) }) *slog.Logger {
	return slog.New(slog.NewTextHandler(&testLogWriter{t}, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

type testLogWriter struct {
	t interface{ Logf(string, ...any) }
}

func (w *testLogWriter) Write(p []byte) (int, error) {
	w.t.Logf("%s", p)
	return len(p), nil
}
