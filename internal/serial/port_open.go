package serial

import (
	"fmt"
	"time"

	goserial "go.bug.st/serial"

	"github.com/xuthus5/mssh/internal/model"
)

// openSerialPort is the serial open entry point; tests may replace it.
var openSerialPort = goserial.Open

// listSerialPorts is the device enumeration entry point; tests may replace it.
var listSerialPorts = goserial.GetPortsList

// OpenPort opens a serial device using the given profile.
func OpenPort(profile model.SerialPort) (*PortSession, error) {
	mode, err := modeFromProfile(profile)
	if err != nil {
		return nil, err
	}
	port, err := openSerialPort(profile.Device, mode)
	if err != nil {
		return nil, mapOpenError(profile.Device, err)
	}
	if err := port.SetReadTimeout(time.Millisecond * 200); err != nil {
		_ = port.Close()
		return nil, fmt.Errorf("set serial read timeout: %w", err)
	}
	session := &PortSession{
		port:       port,
		device:     CanonicalDevicePath(profile.Device),
		profileID:  profile.ID,
		lineEnding: profile.LineEnding,
		localEcho:  profile.LocalEcho,
		dtr:        profile.DTROnOpen,
		rts:        profile.RTSOnOpen,
	}
	if err := applyFlowControl(port, profile); err != nil {
		_ = port.Close()
		return nil, fmt.Errorf("configure serial flow control: %w", err)
	}
	if shouldApplyManualSignals(profile.FlowControl) {
		if err := session.applyInitialSignals(); err != nil {
			_ = port.Close()
			return nil, err
		}
	}
	return session, nil
}

// ListDevices returns system serial device paths (canonicalized).
func ListDevices() ([]string, error) {
	ports, err := listSerialPorts()
	if err != nil {
		return nil, fmt.Errorf("list serial ports: %w", err)
	}
	if ports == nil {
		return []string{}, nil
	}
	return CanonicalDevicePaths(ports), nil
}
