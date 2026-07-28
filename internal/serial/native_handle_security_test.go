package serial

import (
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestExtractNativeHandleRejectsNegativeAndZeroHandles(t *testing.T) {
	type signedPort struct {
		handle int64
	}
	type unsignedPort struct {
		handle uint64
	}

	_, err := extractNativeHandle(&signedPort{handle: -1})
	require.Error(t, err)
	_, err = extractNativeHandle(&signedPort{})
	require.Error(t, err)
	_, err = extractNativeHandle(&unsignedPort{})
	require.Error(t, err)
}

func TestExtractNativeHandleRejectsValuesOutsideNativeRange(t *testing.T) {
	if strconv.IntSize == 64 {
		got, err := nativeHandleFromUint(uint64(^uintptr(0)))
		require.NoError(t, err)
		require.NotZero(t, got)
		return
	}
	type unsignedPort struct {
		handle uint64
	}

	_, err := extractNativeHandle(&unsignedPort{handle: 1 << 32})

	require.Error(t, err)
}
