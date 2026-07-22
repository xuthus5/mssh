package serial

import (
	"fmt"
	"strings"

	goserial "go.bug.st/serial"

	"github.com/xuthus5/mssh/internal/model"
)

// flowMode is the normalized flow-control policy applied to an open port.
type flowMode string

const (
	flowNone    flowMode = "none"
	flowXonXoff flowMode = "xonxoff"
	flowRtsCts  flowMode = "rtscts"
	flowDsrDtr  flowMode = "dsrdtr"
)

func normalizeFlowControl(value string) (flowMode, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", string(flowNone):
		return flowNone, nil
	case string(flowXonXoff):
		return flowXonXoff, nil
	case string(flowRtsCts):
		return flowRtsCts, nil
	case string(flowDsrDtr):
		return flowDsrDtr, nil
	default:
		return "", fmt.Errorf("unsupported flow control %q", value)
	}
}

func applyFlowControl(port goserial.Port, profile model.SerialPort) error {
	mode, err := normalizeFlowControl(profile.FlowControl)
	if err != nil {
		return err
	}
	return applyNativeFlowControl(port, mode, profile.DTROnOpen, profile.RTSOnOpen)
}

func shouldApplyManualSignals(flowControl string) bool {
	mode, err := normalizeFlowControl(flowControl)
	if err != nil {
		return true
	}
	return mode == flowNone || mode == flowXonXoff
}
