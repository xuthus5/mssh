package serial

import (
	"fmt"
)

// extractNativeHandle returns the OS handle stored in go.bug.st/serial concrete ports.
// The library keeps handles private; reflection is required to re-apply termios/DCB
// flow-control flags after Open() forcibly disables them.
func extractNativeHandle(port any) (uintptr, error) {
	_ = port
	return 0, fmt.Errorf("serial native handle access is unavailable; private driver fields are not supported")
}

func nativeHandleFromUint(value uint64) (uintptr, error) {
	if value == 0 {
		return 0, fmt.Errorf("serial port handle is zero")
	}
	if value > uint64(^uintptr(0)) {
		return 0, fmt.Errorf("serial port handle exceeds uintptr range")
	}
	return uintptr(value), nil //nolint:gosec // range is checked against uintptr above.
}
