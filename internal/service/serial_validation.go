package service

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/serial"
)

const (
	maxSerialNameRunes  = 128
	maxSerialNotesRunes = 2000
	maxSerialSortOrder  = 1_000_000
)

func normalizeSerialPort(port model.SerialPort) (model.SerialPort, error) {
	port.Name = strings.TrimSpace(port.Name)
	port.Notes = strings.TrimSpace(port.Notes)
	port.FlowControl = strings.TrimSpace(port.FlowControl)
	port.LineEnding = model.SerialLineEnding(strings.TrimSpace(string(port.LineEnding)))
	device, err := serial.ValidateDevicePath(port.Device)
	if err != nil {
		return model.SerialPort{}, err
	}
	port.Device = device
	if err := validateSerialMetadata(port); err != nil {
		return model.SerialPort{}, err
	}
	port.BaudRate, err = normalizeBaudRate(port.BaudRate)
	if err != nil {
		return model.SerialPort{}, err
	}
	if port.DataBits == 0 {
		port.DataBits = 8
	}
	if port.DataBits < 5 || port.DataBits > 8 {
		return model.SerialPort{}, fmt.Errorf("data bits must be 5-8")
	}
	if err := normalizeSerialEnums(&port); err != nil {
		return model.SerialPort{}, err
	}
	return port, nil
}

func validateSerialMetadata(port model.SerialPort) error {
	if port.Name == "" {
		return fmt.Errorf("serial port name is required")
	}
	if strings.ContainsRune(port.Name, 0) {
		return fmt.Errorf("serial port name contains NUL")
	}
	if utf8.RuneCountInString(port.Name) > maxSerialNameRunes {
		return fmt.Errorf("serial port name must not exceed %d characters", maxSerialNameRunes)
	}
	if strings.ContainsRune(port.Notes, 0) {
		return fmt.Errorf("serial notes contain NUL")
	}
	if utf8.RuneCountInString(port.Notes) > maxSerialNotesRunes {
		return fmt.Errorf("serial notes must not exceed %d characters", maxSerialNotesRunes)
	}
	if port.SortOrder < 0 || port.SortOrder > maxSerialSortOrder {
		return fmt.Errorf("serial sort order must be between 0 and %d", maxSerialSortOrder)
	}
	return nil
}

func normalizeBaudRate(baud int) (int, error) {
	if baud <= 0 {
		baud = 115200
	}
	if baud < 300 || baud > 4_000_000 {
		return 0, fmt.Errorf("baud rate must be between 300 and 4000000")
	}
	return baud, nil
}

func normalizeSerialEnums(port *model.SerialPort) error {
	if err := normalizeSerialParity(port); err != nil {
		return err
	}
	if err := normalizeSerialStopBits(port); err != nil {
		return err
	}
	if port.FlowControl == "" {
		port.FlowControl = "none"
	}
	switch port.FlowControl {
	case "none", "xonxoff", "rtscts", "dsrdtr":
	default:
		return fmt.Errorf("unsupported flow control %q", port.FlowControl)
	}
	if port.LineEnding == "" {
		port.LineEnding = model.SerialLineEndingCR
	}
	switch port.LineEnding {
	case model.SerialLineEndingCR, model.SerialLineEndingLF, model.SerialLineEndingCRLF:
	default:
		return fmt.Errorf("unsupported line ending %q", port.LineEnding)
	}
	return nil
}

func normalizeSerialParity(port *model.SerialPort) error {
	if port.Parity == "" {
		port.Parity = model.SerialParityNone
	}
	switch port.Parity {
	case model.SerialParityNone, model.SerialParityOdd, model.SerialParityEven, model.SerialParityMark, model.SerialParitySpace:
		return nil
	default:
		return fmt.Errorf("unsupported parity %q", port.Parity)
	}
}

func normalizeSerialStopBits(port *model.SerialPort) error {
	if port.StopBits == "" {
		port.StopBits = model.SerialStopBitsOne
	}
	switch port.StopBits {
	case model.SerialStopBitsOne, model.SerialStopBitsOnePointFive, model.SerialStopBitsTwo:
		return nil
	default:
		return fmt.Errorf("unsupported stop bits %q", port.StopBits)
	}
}

func serialOpenConfigurationEqual(current, snapshot model.SerialPort) bool {
	return serial.CanonicalDevicePath(current.Device) == serial.CanonicalDevicePath(snapshot.Device) &&
		current.BaudRate == snapshot.BaudRate &&
		current.DataBits == snapshot.DataBits &&
		current.Parity == snapshot.Parity &&
		current.StopBits == snapshot.StopBits &&
		current.FlowControl == snapshot.FlowControl &&
		current.LineEnding == snapshot.LineEnding &&
		current.LocalEcho == snapshot.LocalEcho &&
		current.DTROnOpen == snapshot.DTROnOpen &&
		current.RTSOnOpen == snapshot.RTSOnOpen
}
