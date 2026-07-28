package ssh

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/pkg/sftp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type durabilityFile struct {
	syncErr  error
	closeErr error
	calls    []string
}

func (f *durabilityFile) Sync() error {
	f.calls = append(f.calls, "sync")
	return f.syncErr
}

func (f *durabilityFile) Close() error {
	f.calls = append(f.calls, "close")
	return f.closeErr
}

func TestFinalizeDownloadedFileReturnsSyncAndCloseErrors(t *testing.T) {
	syncErr := errors.New("sync failed")
	closeErr := errors.New("close failed")
	file := &durabilityFile{syncErr: syncErr, closeErr: closeErr}

	err := finalizeDownloadedFile(file)

	require.Error(t, err)
	assert.ErrorIs(t, err, syncErr)
	assert.ErrorIs(t, err, closeErr)
	assert.Equal(t, []string{"sync", "close"}, file.calls)
}

func TestFinalizeUploadedFileReturnsCloseError(t *testing.T) {
	closeErr := errors.New("remote close failed")
	file := &durabilityFile{closeErr: closeErr}

	err := finalizeUploadedFile(file)

	require.Error(t, err)
	assert.ErrorIs(t, err, closeErr)
	assert.Equal(t, []string{"close"}, file.calls)
}

type closeErrorFileWriter struct {
	delegate sftp.FileWriter
	err      error
}

func (w closeErrorFileWriter) Filewrite(request *sftp.Request) (io.WriterAt, error) {
	writer, err := w.delegate.Filewrite(request)
	if err != nil {
		return nil, err
	}
	closer, _ := writer.(io.Closer)
	return &closeErrorWriterAt{WriterAt: writer, closer: closer, err: w.err}, nil
}

type closeErrorWriterAt struct {
	io.WriterAt
	closer io.Closer
	err    error
}

func (w *closeErrorWriterAt) Close() error {
	var closeErr error
	if w.closer != nil {
		closeErr = w.closer.Close()
	}
	return errors.Join(closeErr, w.err)
}

func TestUploadFileReturnsRemoteCloseError(t *testing.T) {
	handlers := sftp.InMemHandler()
	closeErr := errors.New("forced remote close failure")
	handlers.FilePut = closeErrorFileWriter{delegate: handlers.FilePut, err: closeErr}
	address, cleanup := startSFTPServerWithHandlers(t, handlers)
	defer cleanup()
	wrapper, client := connectSFTP(t, address)
	defer func() { _ = wrapper.Close() }()
	defer func() { _ = client.Close() }()
	source := filepath.Join(t.TempDir(), "source.txt")
	require.NoError(t, os.WriteFile(source, []byte("payload"), 0o600))

	err := UploadFile(client, source, "/target.txt", nil)

	require.Error(t, err)
	assert.ErrorContains(t, err, "close remote upload")
	assert.ErrorContains(t, err, "forced remote close failure")
}
