package crypto

import (
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type failingVaultReader struct {
	readErr  error
	closeErr error
}

func (reader failingVaultReader) Read([]byte) (int, error) {
	return 0, reader.readErr
}

func (reader failingVaultReader) Close() error {
	return reader.closeErr
}

func TestReadVaultDataReturnsReadAndCloseErrors(t *testing.T) {
	readErr := errors.New("read failed")
	closeErr := errors.New("close failed")

	_, err := readVaultData(failingVaultReader{readErr: readErr, closeErr: closeErr})

	require.Error(t, err)
	assert.ErrorIs(t, err, readErr)
	assert.ErrorIs(t, err, closeErr)
}

func TestReadVaultDataRejectsPayloadGrowth(t *testing.T) {
	reader := io.NopCloser(strings.NewReader(strings.Repeat("x", maxVaultFileBytes+1)))

	_, err := readVaultData(reader)

	require.Error(t, err)
	assert.ErrorContains(t, err, "vault file exceeds")
}
