//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package applog

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

func TestOpenDailyLogFileRejectsFIFOWithoutBlocking(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "2026-07-28.log")
	require.NoError(t, unix.Mkfifo(path, 0o600))
	result := make(chan error, 1)
	go func() {
		file, err := openDailyLogFile(directory, "2026-07-28")
		if file != nil {
			_ = file.Close()
		}
		result <- err
	}()

	select {
	case err := <-result:
		require.Error(t, err)
	case <-time.After(250 * time.Millisecond):
		t.Fatal("opening a daily log FIFO blocked")
	}
}
