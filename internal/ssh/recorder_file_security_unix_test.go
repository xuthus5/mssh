//go:build !windows

package ssh

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

type recorderOpenResult struct {
	recorder *Recorder
	err      error
}

func TestNewRecorderRejectsFIFOWithoutBlocking(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recording.fifo")
	require.NoError(t, unix.Mkfifo(path, 0o600))
	result := make(chan recorderOpenResult, 1)
	go func() {
		recorder, err := NewRecorder(path, 80, 24, "xterm")
		result <- recorderOpenResult{recorder: recorder, err: err}
	}()

	select {
	case opened := <-result:
		if opened.recorder != nil {
			_ = opened.recorder.Close()
		}
		assert.Nil(t, opened.recorder)
		require.Error(t, opened.err)
	case <-time.After(250 * time.Millisecond):
		reader, err := unix.Open(path, unix.O_RDONLY|unix.O_NONBLOCK, 0)
		require.NoError(t, err)
		opened := <-result
		if opened.recorder != nil {
			_ = opened.recorder.Close()
		}
		require.NoError(t, unix.Close(reader))
		t.Fatal("opening a recording FIFO blocked")
	}
}
