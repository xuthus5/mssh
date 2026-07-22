package serial

import (
	"errors"
	"fmt"
	"strings"

	goserial "go.bug.st/serial"
)

func mapOpenError(device string, err error) error {
	if err == nil {
		return nil
	}
	var portErr *goserial.PortError
	if errors.As(err, &portErr) {
		switch portErr.Code() {
		case goserial.PortBusy:
			return fmt.Errorf("serial device %s is busy (already open by another process)", device)
		case goserial.PortNotFound:
			return fmt.Errorf("serial device %s was not found", device)
		case goserial.PermissionDenied:
			return fmt.Errorf("permission denied opening %s (check dialout/uucp group or device ACL)", device)
		case goserial.InvalidSerialPort:
			return fmt.Errorf("%s is not a valid serial port", device)
		case goserial.InvalidSpeed:
			return fmt.Errorf("unsupported baud rate for %s", device)
		}
	}
	msg := err.Error()
	lower := strings.ToLower(msg)
	switch {
	case strings.Contains(lower, "permission denied") || strings.Contains(lower, "access is denied"):
		return fmt.Errorf("permission denied opening %s (check dialout/uucp group or device ACL)", device)
	case strings.Contains(lower, "busy") || strings.Contains(lower, "in use"):
		return fmt.Errorf("serial device %s is busy (already open by another process)", device)
	case strings.Contains(lower, "no such file") || strings.Contains(lower, "not found"):
		return fmt.Errorf("serial device %s was not found", device)
	default:
		return fmt.Errorf("open serial %s: %w", device, err)
	}
}
