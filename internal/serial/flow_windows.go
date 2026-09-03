//go:build windows

package serial

import (
	"fmt"

	goserial "go.bug.st/serial"
)

const (
	dcbOutXCTSFlow           uint32 = 0x00000004
	dcbOutXDSRFlow           uint32 = 0x00000008
	dcbDTRControlDisableMask        = ^uint32(0x00000030)
	dcbDTRControlEnable      uint32 = 0x00000010
	dcbDTRControlHandshake   uint32 = 0x00000020
	dcbOutX                  uint32 = 0x00000100
	dcbInX                   uint32 = 0x00000200
	dcbRTSControlDisableMask        = ^uint32(0x00003000)
	dcbRTSControlEnable      uint32 = 0x00001000
	dcbRTSControlHandshake   uint32 = 0x00002000
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
