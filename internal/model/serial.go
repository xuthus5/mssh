package model

import "time"

// SerialParity represents serial parity mode.
type SerialParity string

const (
	SerialParityNone  SerialParity = "none"
	SerialParityOdd   SerialParity = "odd"
	SerialParityEven  SerialParity = "even"
	SerialParityMark  SerialParity = "mark"
	SerialParitySpace SerialParity = "space"
)

// SerialStopBits represents serial stop bit configuration.
type SerialStopBits string

const (
	SerialStopBitsOne          SerialStopBits = "1"
	SerialStopBitsOnePointFive SerialStopBits = "1.5"
	SerialStopBitsTwo          SerialStopBits = "2"
)

// SerialLineEnding controls how Enter / newline is sent to the device.
type SerialLineEnding string

const (
	SerialLineEndingCR   SerialLineEnding = "cr"
	SerialLineEndingLF   SerialLineEnding = "lf"
	SerialLineEndingCRLF SerialLineEnding = "crlf"
)

// SerialPort is a saved serial connection profile.
type SerialPort struct {
	ID          int64            `json:"id"`
	Name        string           `json:"name"`
	Device      string           `json:"device"`
	BaudRate    int              `json:"baud_rate"`
	DataBits    int              `json:"data_bits"`
	Parity      SerialParity     `json:"parity"`
	StopBits    SerialStopBits   `json:"stop_bits"`
	FlowControl string           `json:"flow_control"`
	LineEnding  SerialLineEnding `json:"line_ending"`
	LocalEcho   bool             `json:"local_echo"`
	DTROnOpen   bool             `json:"dtr_on_open"`
	RTSOnOpen   bool             `json:"rts_on_open"`
	Notes       string           `json:"notes"`
	SortOrder   int              `json:"sort_order"`
	CreatedAt   time.Time        `json:"created_at"`
	UpdatedAt   time.Time        `json:"updated_at"`
}

// SerialPortInput is the create/update payload for serial profiles.
type SerialPortInput struct {
	ID          int64            `json:"id"`
	Name        string           `json:"name"`
	Device      string           `json:"device"`
	BaudRate    int              `json:"baud_rate"`
	DataBits    int              `json:"data_bits"`
	Parity      SerialParity     `json:"parity"`
	StopBits    SerialStopBits   `json:"stop_bits"`
	FlowControl string           `json:"flow_control"`
	LineEnding  SerialLineEnding `json:"line_ending"`
	LocalEcho   bool             `json:"local_echo"`
	DTROnOpen   bool             `json:"dtr_on_open"`
	RTSOnOpen   bool             `json:"rts_on_open"`
	Notes       string           `json:"notes"`
	SortOrder   int              `json:"sort_order"`
}

// SerialPort converts the input into a stored profile, applying pointer defaults.
func (input SerialPortInput) SerialPort() SerialPort {
	return SerialPort{
		ID:          input.ID,
		Name:        input.Name,
		Device:      input.Device,
		BaudRate:    input.BaudRate,
		DataBits:    input.DataBits,
		Parity:      input.Parity,
		StopBits:    input.StopBits,
		FlowControl: input.FlowControl,
		LineEnding:  input.LineEnding,
		LocalEcho:   input.LocalEcho,
		DTROnOpen:   input.DTROnOpen,
		RTSOnOpen:   input.RTSOnOpen,
		Notes:       input.Notes,
		SortOrder:   input.SortOrder,
	}
}

// SerialSignals is the runtime modem output state for an open serial terminal.
type SerialSignals struct {
	DTR bool `json:"dtr"`
	RTS bool `json:"rts"`
}
