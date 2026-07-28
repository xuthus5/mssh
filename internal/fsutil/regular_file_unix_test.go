//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package fsutil

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

func TestOpenRegularFilePathDoesNotBlockOnFIFO(t *testing.T) {
	path := filepath.Join(t.TempDir(), "input.fifo")
	require.NoError(t, unix.Mkfifo(path, 0o600))
	result := make(chan *os.File, 1)
	go func() {
		file, _ := openRegularFilePath(path)
		result <- file
	}()

	select {
	case file := <-result:
		require.NotNil(t, file)
		require.NoError(t, file.Close())
	case <-time.After(250 * time.Millisecond):
		t.Fatal("opening a FIFO blocked")
	}
}

func TestOpenRegularFilePathDoesNotFollowSymlink(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target")
	require.NoError(t, os.WriteFile(target, []byte("payload"), 0o600))
	link := filepath.Join(directory, "link")
	require.NoError(t, os.Symlink(target, link))

	file, err := openRegularFilePath(link)

	assert.Nil(t, file)
	require.Error(t, err)
}
