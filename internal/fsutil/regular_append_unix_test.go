//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package fsutil

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

func TestOpenRegularFileForAppendDoesNotBlockOnFIFO(t *testing.T) {
	path := filepath.Join(t.TempDir(), "append.fifo")
	require.NoError(t, unix.Mkfifo(path, 0o600))
	result := make(chan error, 1)
	go func() {
		file, _, err := OpenRegularFileForAppend(path)
		if file != nil {
			_ = file.Close()
		}
		result <- err
	}()

	select {
	case err := <-result:
		require.Error(t, err)
	case <-time.After(250 * time.Millisecond):
		t.Fatal("opening a FIFO for append blocked")
	}
}

func TestCreateRegularFileForAppendDoesNotBlockOnFIFO(t *testing.T) {
	path := filepath.Join(t.TempDir(), "append.fifo")
	require.NoError(t, unix.Mkfifo(path, 0o600))
	result := make(chan error, 1)
	go func() {
		file, _, err := CreateRegularFileForAppend(path, 0o600)
		if file != nil {
			_ = file.Close()
		}
		result <- err
	}()

	select {
	case err := <-result:
		require.Error(t, err)
	case <-time.After(250 * time.Millisecond):
		t.Fatal("creating over a FIFO for append blocked")
	}
}
