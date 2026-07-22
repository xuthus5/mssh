package serial

import (
	"fmt"

	goserial "go.bug.st/serial"

	"github.com/xuthus5/mssh/internal/model"
)

func modeFromProfile(profile model.SerialPort) (*goserial.Mode, error) {
	baud := profile.BaudRate
	if baud <= 0 {
		baud = 115200
	}
	dataBits := profile.DataBits
	if dataBits == 0 {
		dataBits = 8
	}
	if dataBits < 5 || dataBits > 8 {
		return nil, fmt.Errorf("unsupported data bits: %d", dataBits)
	}
	parity, err := mapParity(profile.Parity)
	if err != nil {
		return nil, err
	}
	stopBits, err := mapStopBits(profile.StopBits)
	if err != nil {
		return nil, err
	}
	return &goserial.Mode{
		BaudRate: baud,
		DataBits: dataBits,
		Parity:   parity,
		StopBits: stopBits,
		InitialStatusBits: &goserial.ModemOutputBits{
			DTR: profile.DTROnOpen,
			RTS: profile.RTSOnOpen,
		},
	}, nil
}

func mapParity(value model.SerialParity) (goserial.Parity, error) {
	switch value {
	case "", model.SerialParityNone:
		return goserial.NoParity, nil
	case model.SerialParityOdd:
		return goserial.OddParity, nil
	case model.SerialParityEven:
		return goserial.EvenParity, nil
	case model.SerialParityMark:
		return goserial.MarkParity, nil
	case model.SerialParitySpace:
		return goserial.SpaceParity, nil
	default:
		return 0, fmt.Errorf("unsupported parity: %s", value)
	}
}

func mapStopBits(value model.SerialStopBits) (goserial.StopBits, error) {
	switch value {
	case "", model.SerialStopBitsOne:
		return goserial.OneStopBit, nil
	case model.SerialStopBitsOnePointFive:
		return goserial.OnePointFiveStopBits, nil
	case model.SerialStopBitsTwo:
		return goserial.TwoStopBits, nil
	default:
		return 0, fmt.Errorf("unsupported stop bits: %s", value)
	}
}
