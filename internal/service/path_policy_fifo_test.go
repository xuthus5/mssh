//go:build !windows

package service

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

func TestValidateUploadSourceRejectsFIFO(t *testing.T) {
	path := filepath.Join(t.TempDir(), "blocked.fifo")
	require.NoError(t, unix.Mkfifo(path, 0o600))

	_, err := validateUploadSource(path)

	require.ErrorContains(t, err, "regular file")
}
