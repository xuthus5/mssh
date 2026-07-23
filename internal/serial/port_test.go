package serial

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestModeFromProfileDefaults(t *testing.T) {
	mode, err := modeFromProfile(model.SerialPort{Device: "/dev/ttyUSB0", DTROnOpen: true, RTSOnOpen: false})
	require.NoError(t, err)
	assert.Equal(t, 115200, mode.BaudRate)
	assert.Equal(t, 8, mode.DataBits)
	require.NotNil(t, mode.InitialStatusBits)
	assert.True(t, mode.InitialStatusBits.DTR)
	assert.False(t, mode.InitialStatusBits.RTS)
}

func TestModeFromProfileValidation(t *testing.T) {
	_, err := modeFromProfile(model.SerialPort{BaudRate: 9600, DataBits: 9})
	require.Error(t, err)
	_, err = modeFromProfile(model.SerialPort{BaudRate: 9600, DataBits: 8, Parity: "bad"})
	require.Error(t, err)
	_, err = modeFromProfile(model.SerialPort{BaudRate: 9600, DataBits: 8, StopBits: "3"})
	require.Error(t, err)
}

func TestMapParityAndStopBits(t *testing.T) {
	p, err := mapParity(model.SerialParityEven)
	require.NoError(t, err)
	assert.NotNil(t, p)
	s, err := mapStopBits(model.SerialStopBitsTwo)
	require.NoError(t, err)
	assert.NotNil(t, s)
}

func TestTransformLineEnding(t *testing.T) {
	assert.Equal(t, []byte("a\rb\r"), transformLineEnding([]byte("a\nb\n"), model.SerialLineEndingCR))
	assert.Equal(t, []byte("a\nb\n"), transformLineEnding([]byte("a\rb\r"), model.SerialLineEndingLF))
	assert.Equal(t, []byte("a\r\nb\r\n"), transformLineEnding([]byte("a\nb\n"), model.SerialLineEndingCRLF))
	assert.Equal(t, []byte("a\rb\r"), transformLineEnding([]byte("a\r\nb\n"), model.SerialLineEndingCR))
}

func TestMapOpenErrorBusy(t *testing.T) {
	err := mapOpenError("/dev/ttyUSB0", assertErr("device busy"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "busy")
	err = mapOpenError("/dev/ttyUSB0", assertErr("permission denied"))
	assert.Contains(t, err.Error(), "permission denied")
	err = mapOpenError("/dev/ttyUSB0", assertErr("no such file"))
	assert.Contains(t, err.Error(), "not found")
}

type assertErr string

func (e assertErr) Error() string { return string(e) }

func TestPortSessionWriteAndBreakAfterClose(t *testing.T) {
	session := NewTestPortSession("/dev/ttyTEST")
	require.NoError(t, session.Close())
	_, err := session.Write([]byte("hi"))
	require.Error(t, err)
	require.Error(t, session.Break(10*time.Millisecond))
}
