package ssh

import (
	"bytes"
	"context"
	"errors"
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

type concurrencyTrackingWriter struct {
	delegate  sftp.FileWriter
	delay     time.Duration
	active    atomic.Int32
	maxActive atomic.Int32
}

func (writer *concurrencyTrackingWriter) Filewrite(request *sftp.Request) (io.WriterAt, error) {
	target, err := writer.delegate.Filewrite(request)
	if err != nil {
		return nil, err
	}
	return &concurrencyTrackingWriterAt{tracker: writer, delegate: target}, nil
}

type concurrencyTrackingWriterAt struct {
	tracker  *concurrencyTrackingWriter
	delegate io.WriterAt
}

func (writer *concurrencyTrackingWriterAt) WriteAt(data []byte, offset int64) (int, error) {
	active := writer.tracker.active.Add(1)
	defer writer.tracker.active.Add(-1)
	updateMaxActive(&writer.tracker.maxActive, active)
	time.Sleep(writer.tracker.delay)
	return writer.delegate.WriteAt(data, offset)
}

func updateMaxActive(maxActive *atomic.Int32, active int32) {
	for current := maxActive.Load(); active > current; current = maxActive.Load() {
		if maxActive.CompareAndSwap(current, active) {
			return
		}
	}
}

func TestUploadFilePipelinesConcurrentWrites(t *testing.T) {
	handlers := sftp.InMemHandler()
	tracker := &concurrencyTrackingWriter{delegate: handlers.FilePut, delay: 5 * time.Millisecond}
	handlers.FilePut = tracker
	address, cleanup := startSFTPServerWithHandlers(t, handlers)
	t.Cleanup(cleanup)
	wrapper, client := connectSFTP(t, address)
	t.Cleanup(func() {
		assert.NoError(t, client.Close())
		assert.NoError(t, wrapper.Close())
	})

	content := bytes.Repeat([]byte("0123456789abcdef"), 64*1024)
	source := filepath.Join(t.TempDir(), "source.bin")
	require.NoError(t, os.WriteFile(source, content, 0o600))

	err := UploadFile(client, source, "/concurrent-upload.bin", nil)

	require.NoError(t, err)
	uploaded := readRemoteOwnershipFile(t, client, "/concurrent-upload.bin")
	assert.Equal(t, string(content), uploaded)
	assert.Greater(t, tracker.maxActive.Load(), int32(1))
}

type readErrorReader struct {
	err error
}

func (reader readErrorReader) Read([]byte) (int, error) {
	return 0, reader.err
}

func TestCopyUploadedFilePropagatesReadError(t *testing.T) {
	address, cleanup := startSFTPServer(t)
	t.Cleanup(cleanup)
	wrapper, client := connectSFTP(t, address)
	cleanupOwnershipSFTPClient(t, wrapper, client)
	remote, err := client.Create("/read-error.bin")
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, remote.Close()) })
	readErr := errors.New("local read failed")

	err = copyUploadedFile(context.Background(), remote, readErrorReader{err: readErr}, 1, nil)

	assert.ErrorIs(t, err, readErr)
}

type cancelOnReadReader struct {
	cancel context.CancelFunc
	data   []byte
	read   bool
}

func (reader *cancelOnReadReader) Read(data []byte) (int, error) {
	if reader.read {
		return 0, io.EOF
	}
	reader.read = true
	reader.cancel()
	return copy(data, reader.data), nil
}

func TestCopyUploadedFileStopsAfterCancellation(t *testing.T) {
	address, cleanup := startSFTPServer(t)
	t.Cleanup(cleanup)
	wrapper, client := connectSFTP(t, address)
	cleanupOwnershipSFTPClient(t, wrapper, client)
	remote, err := client.Create("/cancelled-upload.bin")
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, remote.Close()) })
	ctx, cancel := context.WithCancel(context.Background())
	reader := &cancelOnReadReader{cancel: cancel, data: bytes.Repeat([]byte("x"), 32*1024)}

	err = copyUploadedFile(ctx, remote, reader, int64(len(reader.data)), nil)

	assert.ErrorIs(t, err, context.Canceled)
}
