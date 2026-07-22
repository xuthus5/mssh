//go:build !(linux || darwin || freebsd || openbsd || netbsd || dragonfly || windows)

package serial

import (
	"fmt"

	goserial "go.bug.st/serial"
)

func applyNativeFlowControl(port goserial.Port, mode flowMode, dtrOnOpen, rtsOnOpen bool) error {
	_ = port
	_ = dtrOnOpen
	_ = rtsOnOpen
	if mode == flowNone {
		return nil
	}
	return fmt.Errorf("serial flow control %q is not supported on this platform", mode)
}
