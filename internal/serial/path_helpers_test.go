package serial

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWindowsDeviceHelpers(t *testing.T) {
	assert.True(t, isDigits("123"))
	assert.False(t, isDigits(""))
	assert.False(t, isDigits("12a"))

	assert.True(t, isWindowsSerialDevice(`\\.\COM3`))
	assert.True(t, isWindowsSerialDevice("COM12"))
	assert.False(t, isWindowsSerialDevice("COM"))
	assert.False(t, isWindowsSerialDevice("LPT1"))
	assert.False(t, isWindowsSerialDevice(`/dev/ttyUSB0`))

	assert.Equal(t, `\\.\COM3`, canonicalWindowsDevice("com3"))
	assert.Equal(t, `\\.\COM3`, canonicalWindowsDevice(`\\.\com3`))
	assert.Equal(t, `\\.\COM10`, canonicalWindowsDevice(`COM10\`))
	assert.Equal(t, "OTHER", canonicalWindowsDevice("other"))
}

func TestValidateDevicePathTooLong(t *testing.T) {
	long := "/dev/tty" + strings.Repeat("x", 4100)
	_, err := ValidateDevicePath(long)
	require.Error(t, err)
}

func TestCanonicalDevicePathsEmpty(t *testing.T) {
	assert.Equal(t, []string{}, CanonicalDevicePaths(nil))
	assert.Equal(t, []string{}, CanonicalDevicePaths([]string{}))
}
