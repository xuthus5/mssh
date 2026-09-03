//go:build linux || darwin || freebsd || openbsd || netbsd || dragonfly

package serial

import (
	"fmt"

	goserial "go.bug.st/serial"
)

func applyNativeFlowControl(port goserial.Port, mode flowMode, dtrOnOpen, rtsOnOpen bool) error {
	if mode != flowNone {
		return fmt.Errorf("serial flow control %q is unavailable without a public driver API", mode)
	}
	if err := port.SetDTR(dtrOnOpen); err != nil {
		return fmt.Errorf("set DTR: %w", err)
	}
	if err := port.SetRTS(rtsOnOpen); err != nil {
		return fmt.Errorf("set RTS: %w", err)
	}
	return nil
}
