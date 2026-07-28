//go:build !windows

package ssh

import (
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

func TestOpenUploadSourceRejectsFIFOWithoutBlocking(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.fifo")
	require.NoError(t, unix.Mkfifo(path, 0o600))
	result := make(chan error, 1)
	go func() {
		_, _, err := openUploadSource(path)
		result <- err
	}()

	select {
	case err := <-result:
		require.Error(t, err)
		assert.Contains(t, err.Error(), "regular file")
	case <-time.After(250 * time.Millisecond):
		t.Fatal("opening an upload FIFO blocked")
	}
}

func TestOpenUploadSourceAllowsSymlinkToRegularFile(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	require.NoError(t, os.WriteFile(target, []byte("payload"), 0o600))
	link := filepath.Join(dir, "source")
	require.NoError(t, os.Symlink(target, link))

	file, info, err := openUploadSource(link)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, file.Close()) })
	content, err := io.ReadAll(file)
	require.NoError(t, err)
	assert.Equal(t, "payload", string(content))
	assert.Equal(t, int64(len("payload")), info.Size())
}
