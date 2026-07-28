package serial

import (
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func (p *PortSession) applyInitialSignals() error {
	if err := p.port.SetDTR(p.dtr); err != nil {
		return fmt.Errorf("set DTR: %w", err)
	}
	if err := p.port.SetRTS(p.rts); err != nil {
		return fmt.Errorf("set RTS: %w", err)
	}
	return nil
}

// SetSignals updates DTR/RTS modem output lines.
func (p *PortSession) SetSignals(dtr, rts bool) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.port == nil {
		return fmt.Errorf("serial port not available")
	}
	if err := p.port.SetDTR(dtr); err != nil {
		return fmt.Errorf("set DTR: %w", err)
	}
	p.dtr = dtr
	if err := p.port.SetRTS(rts); err != nil {
		return fmt.Errorf("set RTS: %w", err)
	}
	p.rts = rts
	return nil
}

// Signals returns DTR/RTS output state plus live modem input bits when available.
func (p *PortSession) Signals() (model.SerialSignals, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := model.SerialSignals{DTR: p.dtr, RTS: p.rts}
	if p.port == nil || p.exited {
		return out, nil
	}
	bits, err := p.port.GetModemStatusBits()
	if err != nil {
		return out, fmt.Errorf("read modem status: %w", err)
	}
	if bits == nil {
		return out, fmt.Errorf("read modem status: no status returned")
	}
	out.CTS = bits.CTS
	out.DSR = bits.DSR
	out.DCD = bits.DCD
	out.RI = bits.RI
	return out, nil
}

// Break sends a break condition for the given duration.
func (p *PortSession) Break(duration time.Duration) error {
	p.mu.RLock()
	port := p.port
	exited := p.exited
	p.mu.RUnlock()
	if exited || port == nil {
		return fmt.Errorf("serial port not available")
	}
	if duration <= 0 {
		duration = 250 * time.Millisecond
	}
	if duration > 2*time.Second {
		duration = 2 * time.Second
	}
	return port.Break(duration)
}
