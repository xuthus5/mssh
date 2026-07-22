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
	if err := p.port.SetRTS(rts); err != nil {
		return fmt.Errorf("set RTS: %w", err)
	}
	p.dtr = dtr
	p.rts = rts
	return nil
}

// Signals returns the last requested DTR/RTS state.
func (p *PortSession) Signals() model.SerialSignals {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return model.SerialSignals{DTR: p.dtr, RTS: p.rts}
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
