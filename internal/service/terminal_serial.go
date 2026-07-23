package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/serial"
)

// OpenSerial opens a terminal attached to a configured serial port profile.
func (t *TerminalService) OpenSerial(ctx context.Context, serialPortID int64, cols, rows int) (string, error) {
	_ = ctx
	if serialPortID <= 0 {
		return "", fmt.Errorf("invalid serial port id")
	}
	if err := validateTerminalSize(cols, rows); err != nil {
		return "", err
	}
	outcome := "failed"
	defer func() {
		if t.sessionSvc != nil {
			recordAudit(t.sessionSvc.db, t.logger, model.AuditEvent{
				Action: "connect", TargetType: "serial_port", TargetID: fmt.Sprint(serialPortID),
				Summary: "串口连接", Outcome: outcome,
			})
		}
	}()
	if t.serialSvc == nil {
		return "", fmt.Errorf("serial service unavailable")
	}
	profile, err := t.serialSvc.Get(serialPortID)
	if err != nil {
		return "", fmt.Errorf("serial open: %w", err)
	}
	terminalID := uuid.New().String()
	if err := t.serialSvc.reserveDevice(profile.Device, terminalID); err != nil {
		return "", err
	}
	port, err := serial.OpenPort(*profile)
	if err != nil {
		t.serialSvc.releaseDevice(profile.Device, terminalID)
		t.logger.Error("serial open failed", "serialPortID", serialPortID, "error", err)
		return "", fmt.Errorf("serial open: %w", err)
	}
	t.registerTerminal(terminalID, "", port)
	t.logger.Info("serial terminal opened", "terminalID", terminalID, "device", profile.Device)
	outcome = "success"
	return terminalID, nil
}

func (t *TerminalService) serialPortSession(terminalID string) (*serial.PortSession, error) {
	t.mu.RLock()
	pty, ok := t.ptys[terminalID]
	t.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("terminal %s not found", terminalID)
	}
	port, ok := pty.(*serial.PortSession)
	if !ok {
		return nil, fmt.Errorf("terminal %s is not a serial session", terminalID)
	}
	return port, nil
}

// SerialSetSignals updates DTR/RTS for an open serial terminal.
func (t *TerminalService) SerialSetSignals(terminalID string, dtr, rts bool) error {
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	port, err := t.serialPortSession(terminalID)
	if err != nil {
		return err
	}
	return port.SetSignals(dtr, rts)
}

// SerialSignals returns DTR/RTS outputs and modem input status for an open serial terminal.
func (t *TerminalService) SerialSignals(terminalID string) (model.SerialSignals, error) {
	if err := validateTerminalID(terminalID); err != nil {
		return model.SerialSignals{}, err
	}
	port, err := t.serialPortSession(terminalID)
	if err != nil {
		return model.SerialSignals{}, err
	}
	return port.Signals(), nil
}

// SerialBreak sends a break signal on an open serial terminal.
func (t *TerminalService) SerialBreak(terminalID string, durationMs int) error {
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	port, err := t.serialPortSession(terminalID)
	if err != nil {
		return err
	}
	return port.Break(time.Duration(durationMs) * time.Millisecond)
}

func (t *TerminalService) releaseSerialDevice(terminalID string, pty terminalIO) {
	if t.serialSvc == nil || pty == nil {
		return
	}
	port, ok := pty.(*serial.PortSession)
	if !ok {
		return
	}
	t.serialSvc.releaseDevice(port.Device(), terminalID)
}
