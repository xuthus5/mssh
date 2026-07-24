//go:build unix

package serial

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestApplyNativeFlowControlRejectsMissingHandle(t *testing.T) {
	port := &fakePort{writeN: -1}
	// fakePort has no "handle" field → extractNativeHandle fails early.
	err := applyNativeFlowControl(port, flowNone, true, false)
	require.Error(t, err)

	type withHandle struct {
		fakePort
		handle int
	}
	wrapped := &withHandle{fakePort: fakePort{writeN: -1}, handle: -1}
	// Invalid fd should fail at getTermios.
	err = applyNativeFlowControl(wrapped, flowXonXoff, true, true)
	require.Error(t, err)
	err = applyNativeFlowControl(wrapped, flowRtsCts, true, true)
	require.Error(t, err)
	err = applyNativeFlowControl(wrapped, flowDsrDtr, true, true)
	require.Error(t, err)
	err = applyNativeFlowControl(wrapped, flowMode("bad"), true, true)
	require.Error(t, err)
}

func TestApplyFlowControlWithFakePort(t *testing.T) {
	port := &fakePort{writeN: -1}
	err := applyFlowControl(port, model.SerialPort{FlowControl: "none", DTROnOpen: true, RTSOnOpen: false})
	require.Error(t, err)
}
