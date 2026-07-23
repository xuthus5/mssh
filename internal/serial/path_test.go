package serial

import (
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCanonicalDevicePathEmpty(t *testing.T) {
	assert.Equal(t, "", CanonicalDevicePath("  "))
}

func TestCanonicalDevicePathUnixCleans(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix path test")
	}
	got := CanonicalDevicePath("/dev/./ttyUSB0")
	assert.Equal(t, filepath.Clean("/dev/ttyUSB0"), got)
}

func TestCanonicalDevicePathWindowsCOM(t *testing.T) {
	if runtime.GOOS != "windows" {
		// Exercise windows branch logic via direct helper is not exported;
		// still validate non-empty pass-through on non-windows.
		assert.NotEmpty(t, CanonicalDevicePath("/dev/ttyS0"))
		return
	}
	assert.Equal(t, `\\.\COM3`, CanonicalDevicePath("com3"))
	assert.Equal(t, `\\.\COM3`, CanonicalDevicePath(`\\.\COM3`))
}

func TestCanonicalDevicePathsDedup(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix dedup")
	}
	got := CanonicalDevicePaths([]string{"/dev/ttyUSB0", "/dev/./ttyUSB0", "  "})
	require.Len(t, got, 1)
	assert.Equal(t, filepath.Clean("/dev/ttyUSB0"), got[0])
}

func TestSignalsClosedPort(t *testing.T) {
	session := NewTestPortSession("/dev/ttyTEST")
	require.NoError(t, session.Close())
	signals := session.Signals()
	assert.False(t, signals.DTR)
	assert.False(t, signals.RTS)
	assert.False(t, signals.CTS)
}

func TestValidateDevicePath(t *testing.T) {
	if runtime.GOOS == "windows" {
		got, err := ValidateDevicePath("com3")
		require.NoError(t, err)
		assert.Equal(t, `\\.\COM3`, got)
		_, err = ValidateDevicePath(`C:\Windows\System32\cmd.exe`)
		require.Error(t, err)
		return
	}
	got, err := ValidateDevicePath("/dev/ttyUSB0")
	require.NoError(t, err)
	assert.Equal(t, filepath.Clean("/dev/ttyUSB0"), got)
	_, err = ValidateDevicePath("")
	require.Error(t, err)
	_, err = ValidateDevicePath("a" + string(rune(0)) + "b")
	require.Error(t, err)
	_, err = ValidateDevicePath("/etc/passwd")
	require.Error(t, err)
	_, err = ValidateDevicePath("ttyUSB0")
	require.Error(t, err)
}
