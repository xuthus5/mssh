package ssh

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type concurrencyTrackingReader struct {
	delegate  sftp.FileReader
	delay     time.Duration
	active    atomic.Int32
	maxActive atomic.Int32
}

func (reader *concurrencyTrackingReader) Fileread(request *sftp.Request) (io.ReaderAt, error) {
	target, err := reader.delegate.Fileread(request)
	if err != nil {
		return nil, err
	}
	return &concurrencyTrackingReaderAt{tracker: reader, delegate: target}, nil
}

type concurrencyTrackingReaderAt struct {
	tracker  *concurrencyTrackingReader
	delegate io.ReaderAt
}

func (reader *concurrencyTrackingReaderAt) ReadAt(data []byte, offset int64) (int, error) {
	active := reader.tracker.active.Add(1)
	defer reader.tracker.active.Add(-1)
	for current := reader.tracker.maxActive.Load(); active > current; current = reader.tracker.maxActive.Load() {
		if reader.tracker.maxActive.CompareAndSwap(current, active) {
			break
		}
	}
	time.Sleep(reader.tracker.delay)
	return reader.delegate.ReadAt(data, offset)
}

func TestDownloadFilePipelinesConcurrentReads(t *testing.T) {
	handlers := sftp.InMemHandler()
	tracker := &concurrencyTrackingReader{delegate: handlers.FileGet, delay: 5 * time.Millisecond}
	handlers.FileGet = tracker
	address, cleanup := startSFTPServerWithHandlers(t, handlers)
	t.Cleanup(cleanup)
	wrapper, client := connectSFTP(t, address)
	t.Cleanup(func() {
		assert.NoError(t, client.Close())
		assert.NoError(t, wrapper.Close())
	})

	content := bytes.Repeat([]byte("0123456789abcdef"), 32*1024)
	remote, err := client.Create("/concurrent-download.bin")
	require.NoError(t, err)
	_, err = remote.Write(content)
	require.NoError(t, err)
	require.NoError(t, remote.Close())
	target := filepath.Join(t.TempDir(), "download.bin")

	err = DownloadFileContext(context.Background(), client, "/concurrent-download.bin", target, nil)

	require.NoError(t, err)
	downloaded, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, content, downloaded)
	assert.Greater(t, tracker.maxActive.Load(), int32(1))
}
