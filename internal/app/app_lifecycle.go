package app

import (
	"fmt"
	"log/slog"

	"github.com/xuthus5/mssh/internal/service"
)

type terminalRecordingStopper interface {
	StopTerminalRecordingIfActive(terminalID string) error
}

type transferQuiescer interface {
	PauseAndWait()
}

type tunnelQuiescer interface {
	StopAllWithError() error
}

type syncLifecycleAdapter struct {
	file     transferQuiescer
	terminal *service.TerminalService
	tunnel   tunnelQuiescer
	session  *service.SessionService
}

func (s syncLifecycleAdapter) PrepareDestructiveSync() error {
	if s.file != nil {
		s.file.PauseAndWait()
	}
	if err := service.CloseAllTerminals(s.terminal); err != nil {
		return err
	}
	if s.tunnel != nil {
		if err := s.tunnel.StopAllWithError(); err != nil {
			return fmt.Errorf("close tunnels before destructive sync: %w", err)
		}
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
	logger := shutdownLogger(a.logger)
	a.shutdownOperations()
	a.shutdownRuntimeResources(logger)
	a.shutdownInfrastructure(logger)
}

func shutdownLogger(logger *slog.Logger) *slog.Logger {
	if logger != nil {
		return logger
	}
	return slog.Default()
}

func (a *App) shutdownOperations() {
	a.shutdownAuxiliaryOperations()
	a.shutdownCoreOperations()
}

func (a *App) shutdownAuxiliaryOperations() {
	if a.About != nil {
		a.About.Shutdown()
	}
	if a.Font != nil {
		a.Font.Shutdown()
	}
	if a.Macro != nil {
		a.Macro.Shutdown()
	}
	if a.Key != nil {
		a.Key.Shutdown()
	}
	if a.Theme != nil {
		a.Theme.Shutdown()
	}
	if a.AssetCatalog != nil {
		a.AssetCatalog.Shutdown()
	}
	if a.Serial != nil {
		a.Serial.Shutdown()
	}
	if a.CommandHistory != nil {
		a.CommandHistory.Shutdown()
	}
	if a.Audit != nil {
		a.Audit.Shutdown()
	}
}

func (a *App) shutdownCoreOperations() {
	if a.Log != nil {
		a.Log.StopOperationsAndWait()
	}
	if a.Setting != nil {
		a.Setting.Shutdown()
	}
	if a.Sync != nil {
		a.Sync.Shutdown()
	}
	if a.AI != nil {
		a.AI.Shutdown()
	}
	if a.Tunnel != nil {
		a.Tunnel.StopOperations()
	}
	if a.Session != nil {
		a.Session.StopOperationsAndWait()
	}
	if a.Tunnel != nil {
		a.Tunnel.WaitOperations()
	}
	if a.Security != nil {
		a.Security.Shutdown()
	}
}

func (a *App) shutdownRuntimeResources(logger *slog.Logger) {
	if a.File != nil {
		a.File.StopAndWait()
	}
	if a.Terminal != nil {
		if err := a.Terminal.Shutdown(); err != nil {
			logger.Error("close terminals during shutdown failed", "error", err)
		}
	}
	if a.Log != nil {
		if err := a.Log.Shutdown(); err != nil {
			logger.Error("close active recordings during shutdown failed", "error", err)
		}
	}
	if a.Tunnel != nil {
		if err := a.Tunnel.Shutdown(); err != nil {
			logger.Error("close tunnels during shutdown failed", "error", err)
		}
	}
	if a.Session != nil {
		if err := a.Session.Shutdown(); err != nil {
			logger.Error("close SSH connections during shutdown failed", "error", err)
		}
	}
}

func (a *App) shutdownInfrastructure(logger *slog.Logger) {
	if a.proxyManager != nil {
		a.proxyManager.CloseIdleConnections()
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
