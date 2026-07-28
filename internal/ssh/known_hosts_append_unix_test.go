//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package ssh

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

func TestOpenKnownHostsAppendFileRejectsFIFOWithoutBlocking(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, unix.Mkfifo(path, 0o600))
	result := make(chan error, 1)
	go func() {
		file, err := openKnownHostsAppendFile(path, 1)
		if file != nil {
			_ = file.Close()
		}
		result <- err
	}()

	select {
	case err := <-result:
		require.Error(t, err)
	case <-time.After(250 * time.Millisecond):
		t.Fatal("opening known_hosts FIFO for append blocked")
	}
}
