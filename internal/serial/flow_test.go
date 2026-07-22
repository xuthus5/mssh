package serial

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestNormalizeFlowControl(t *testing.T) {
	mode, err := normalizeFlowControl("")
	require.NoError(t, err)
	assert.Equal(t, flowNone, mode)

	mode, err = normalizeFlowControl("RTSCTS")
	require.NoError(t, err)
	assert.Equal(t, flowRtsCts, mode)

	mode, err = normalizeFlowControl("xonxoff")
	require.NoError(t, err)
	assert.Equal(t, flowXonXoff, mode)

	mode, err = normalizeFlowControl("dsrdtr")
	require.NoError(t, err)
	assert.Equal(t, flowDsrDtr, mode)

	_, err = normalizeFlowControl("bad")
	require.Error(t, err)
}

func TestShouldApplyManualSignals(t *testing.T) {
	assert.True(t, shouldApplyManualSignals("none"))
	assert.True(t, shouldApplyManualSignals("xonxoff"))
	assert.False(t, shouldApplyManualSignals("rtscts"))
	assert.False(t, shouldApplyManualSignals("dsrdtr"))
}

func TestExtractNativeHandle(t *testing.T) {
	type fakePort struct {
		handle int
	}
	port := &fakePort{handle: 42}
	got, err := extractNativeHandle(port)
	require.NoError(t, err)
	assert.Equal(t, uintptr(42), got)

	_, err = extractNativeHandle(nil)
	require.Error(t, err)
	_, err = extractNativeHandle(fakePort{handle: 1})
	require.Error(t, err)
}

func TestApplyFlowControlInvalidMode(t *testing.T) {
	err := applyFlowControl(nil, model.SerialPort{FlowControl: "bad"})
	require.Error(t, err)
}
