package fsutil

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type privateAtomicFileStub struct {
	name      string
	chmodErr  error
	writeErr  error
	syncErr   error
	closeErr  error
	written   int
	mode      os.FileMode
	content   []byte
	closeCall int
}

func (file *privateAtomicFileStub) Name() string { return file.name }

func (file *privateAtomicFileStub) Chmod(mode os.FileMode) error {
	file.mode = mode
	return file.chmodErr
}

func (file *privateAtomicFileStub) Write(data []byte) (int, error) {
	file.content = append([]byte(nil), data...)
	if file.written > 0 {
		return file.written, file.writeErr
	}
	return len(data), file.writeErr
}

func (file *privateAtomicFileStub) Sync() error { return file.syncErr }

func (file *privateAtomicFileStub) Close() error {
	file.closeCall++
	return file.closeErr
}

func TestWritePrivateFileAtomicWithOperationsCommitsWithoutStaleCleanup(t *testing.T) {
	file := &privateAtomicFileStub{name: "/data/.temp"}
	var replacedSource, replacedTarget string
	removeCalls := 0
	err := writePrivateFileAtomicWithOperations("/data/target", []byte("payload"), privateAtomicWriteOptions{
		pattern: ".temp-*",
		operations: privateAtomicFileOperations{
			createTemp: func(string, string) (privateAtomicFile, error) { return file, nil },
			replace: func(source, target string) error {
				replacedSource, replacedTarget = source, target
				return nil
			},
			remove: func(string) error {
				removeCalls++
				return nil
			},
		},
	})

	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), file.mode)
	assert.Equal(t, []byte("payload"), file.content)
	assert.Equal(t, 1, file.closeCall)
	assert.Equal(t, "/data/.temp", replacedSource)
	assert.Equal(t, "/data/target", replacedTarget)
	assert.Zero(t, removeCalls)
}

func TestWritePrivateFileAtomicWithOperationsPreservesWriteCloseAndCleanupFailures(t *testing.T) {
	writeErr := errors.New("write failed")
	closeErr := errors.New("close failed")
	removeErr := errors.New("remove failed")
	file := &privateAtomicFileStub{name: "/data/.temp", writeErr: writeErr, closeErr: closeErr}
	replaceCalls := 0

	err := writePrivateFileAtomicWithOperations("/data/target", []byte("payload"), privateAtomicWriteOptions{
		pattern: ".temp-*",
		operations: privateAtomicFileOperations{
			createTemp: func(string, string) (privateAtomicFile, error) { return file, nil },
			replace: func(string, string) error {
				replaceCalls++
				return nil
			},
			remove: func(string) error { return removeErr },
		},
	})

	assert.ErrorIs(t, err, writeErr)
	assert.ErrorIs(t, err, closeErr)
	assert.ErrorIs(t, err, removeErr)
	assert.Zero(t, replaceCalls)
}

func TestWritePrivateFileAtomicWithOperationsRejectsShortWrite(t *testing.T) {
	file := &privateAtomicFileStub{name: "/data/.temp", written: 2}

	err := writePrivateFileAtomicWithOperations("/data/target", []byte("payload"), privateAtomicWriteOptions{
		pattern: ".temp-*",
		operations: privateAtomicFileOperations{
			createTemp: func(string, string) (privateAtomicFile, error) { return file, nil },
			replace:    func(string, string) error { return nil },
			remove:     func(string) error { return nil },
		},
	})

	assert.ErrorIs(t, err, io.ErrShortWrite)
}

func TestWritePrivateFileAtomicWithOperationsPreservesStageFailures(t *testing.T) {
	tests := []struct {
		name string
		file *privateAtomicFileStub
	}{
		{name: "chmod", file: &privateAtomicFileStub{name: "/data/.temp", chmodErr: errors.New("chmod failed")}},
		{name: "sync", file: &privateAtomicFileStub{name: "/data/.temp", syncErr: errors.New("sync failed")}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := writePrivateFileAtomicWithOperations("/data/target", []byte("payload"), privateAtomicWriteOptions{
				pattern: ".temp-*",
				operations: privateAtomicFileOperations{
					createTemp: func(string, string) (privateAtomicFile, error) { return test.file, nil },
					remove:     func(string) error { return nil },
				},
			})

			require.Error(t, err)
			assert.Contains(t, err.Error(), test.name+" failed")
			assert.Equal(t, 1, test.file.closeCall)
		})
	}
}

func TestWritePrivateFileAtomicWithOperationsPreservesCreateAndReplaceFailures(t *testing.T) {
	createErr := errors.New("create failed")
	err := writePrivateFileAtomicWithOperations("/data/target", nil, privateAtomicWriteOptions{
		operations: privateAtomicFileOperations{
			createTemp: func(string, string) (privateAtomicFile, error) { return nil, createErr },
		},
	})
	assert.ErrorIs(t, err, createErr)

	replaceErr := errors.New("replace failed")
	file := &privateAtomicFileStub{name: "/data/.temp"}
	err = writePrivateFileAtomicWithOperations("/data/target", nil, privateAtomicWriteOptions{
		operations: privateAtomicFileOperations{
			createTemp: func(string, string) (privateAtomicFile, error) { return file, nil },
			replace:    func(string, string) error { return replaceErr },
			remove:     func(string) error { return os.ErrNotExist },
		},
	})
	assert.ErrorIs(t, err, replaceErr)
}

func TestWritePrivateFileAtomicWithOperationsClosesUnnamedTemporary(t *testing.T) {
	closeErr := errors.New("close failed")
	file := &privateAtomicFileStub{closeErr: closeErr}

	err := writePrivateFileAtomicWithOperations("/data/target", nil, privateAtomicWriteOptions{
		operations: privateAtomicFileOperations{
			createTemp: func(string, string) (privateAtomicFile, error) { return file, nil },
		},
	})

	assert.ErrorContains(t, err, "path is empty")
	assert.ErrorIs(t, err, closeErr)
}

func TestCloseUnnamedAtomicTemporaryReturnsPathErrorAfterSuccessfulClose(t *testing.T) {
	file := &privateAtomicFileStub{}

	err := closeUnnamedAtomicTemporary(file)

	assert.ErrorContains(t, err, "path is empty")
	assert.Equal(t, 1, file.closeCall)
}

func TestWritePrivateFileAtomicWritesPrivateFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "target")
	require.NoError(t, os.WriteFile(path, []byte("old"), 0o644))

	require.NoError(t, WritePrivateFileAtomic(path, []byte("payload"), ".temp-*"))
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, "payload", string(data))
	if os.PathSeparator != '\\' {
		info, statErr := os.Stat(path)
		require.NoError(t, statErr)
		assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	}
	matches, err := filepath.Glob(filepath.Join(filepath.Dir(path), ".temp-*"))
	require.NoError(t, err)
	assert.Empty(t, matches)
}
