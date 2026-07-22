//go:build windows

package serial

import (
	"fmt"

	goserial "go.bug.st/serial"
	"golang.org/x/sys/windows"
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
	handleValue, err := extractNativeHandle(port)
	if err != nil {
		return fmt.Errorf("apply flow control: %w", err)
	}
	handle := windows.Handle(handleValue)
	params := &windows.DCB{}
	if err := windows.GetCommState(handle, params); err != nil {
		return fmt.Errorf("get comm state: %w", err)
	}

	// Clear prior flow-control related flags.
	params.Flags &^= dcbOutXCTSFlow | dcbOutXDSRFlow | dcbOutX | dcbInX
	params.Flags &= dcbDTRControlDisableMask
	params.Flags &= dcbRTSControlDisableMask

	switch mode {
	case flowNone:
		if dtrOnOpen {
			params.Flags |= dcbDTRControlEnable
		}
		if rtsOnOpen {
			params.Flags |= dcbRTSControlEnable
		}
	case flowXonXoff:
		params.Flags |= dcbOutX | dcbInX
		if dtrOnOpen {
			params.Flags |= dcbDTRControlEnable
		}
		if rtsOnOpen {
			params.Flags |= dcbRTSControlEnable
		}
		params.XonChar = 17
		params.XoffChar = 19
		params.XonLim = 2048
		params.XoffLim = 512
	case flowRtsCts:
		params.Flags |= dcbOutXCTSFlow | dcbRTSControlHandshake
		if dtrOnOpen {
			params.Flags |= dcbDTRControlEnable
		}
	case flowDsrDtr:
		params.Flags |= dcbOutXDSRFlow | dcbDTRControlHandshake
		if rtsOnOpen {
			params.Flags |= dcbRTSControlEnable
		}
	default:
		return fmt.Errorf("unsupported flow control %q", mode)
	}

	if err := windows.SetCommState(handle, params); err != nil {
		return fmt.Errorf("set comm state flow control: %w", err)
	}

	// Manual line levels for non-handshake output controls.
	if mode == flowNone || mode == flowXonXoff {
		if err := port.SetDTR(dtrOnOpen); err != nil {
			return fmt.Errorf("set DTR after flow control: %w", err)
		}
		if err := port.SetRTS(rtsOnOpen); err != nil {
			return fmt.Errorf("set RTS after flow control: %w", err)
		}
	}
	return nil
}
