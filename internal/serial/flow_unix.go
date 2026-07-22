//go:build linux || darwin || freebsd || openbsd || netbsd || dragonfly

package serial

import (
	"fmt"

	goserial "go.bug.st/serial"
	"golang.org/x/sys/unix"
)

func applyNativeFlowControl(port goserial.Port, mode flowMode, dtrOnOpen, rtsOnOpen bool) error {
	fd, err := extractNativeHandle(port)
	if err != nil {
		return fmt.Errorf("apply flow control: %w", err)
	}
	termios, err := getTermios(int(fd))
	if err != nil {
		return fmt.Errorf("get termios: %w", err)
	}

	// Always start from a known baseline: disable hardware and software flow control.
	disableHardwareFlow(termios)
	termios.Iflag &^= unix.IXON | unix.IXOFF | unix.IXANY

	switch mode {
	case flowNone:
		// no-op beyond baseline
	case flowXonXoff:
		termios.Iflag |= unix.IXON | unix.IXOFF
	case flowRtsCts:
		enableHardwareFlow(termios)
	case flowDsrDtr:
		// POSIX termios has no portable DSR/DTR hardware handshake.
		// Keep DTR/RTS policy from the profile and leave software/hardware flow off.
		// On platforms with CRTSCTS-only hardware flow, prefer no false RTS/CTS enablement.
	default:
		return fmt.Errorf("unsupported flow control %q", mode)
	}

	if err := setTermios(int(fd), termios); err != nil {
		return fmt.Errorf("set termios flow control: %w", err)
	}

	// Re-assert manual modem lines for non-handshake modes.
	if mode == flowNone || mode == flowXonXoff || mode == flowDsrDtr {
		if err := port.SetDTR(dtrOnOpen); err != nil {
			return fmt.Errorf("set DTR after flow control: %w", err)
		}
		if err := port.SetRTS(rtsOnOpen); err != nil {
			return fmt.Errorf("set RTS after flow control: %w", err)
		}
	}
	return nil
}
