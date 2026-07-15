package ssh

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestNewRecorder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.msshlog")
	r, err := NewRecorder(path, 120, 40, "xterm-256color")
	require.NoError(t, err)
	defer func() { _ = r.Close() }()

	_, statErr := os.Stat(path)
	assert.NoError(t, statErr)
}

func TestNewRecorderInvalidPath(t *testing.T) {
	_, err := NewRecorder("/root__nonexistent__/subdir/file.msshlog", 80, 24, "vt100")
	assert.Error(t, err)
}

func TestNewRecorderDefaultTermType(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty_term.msshlog")
	r, err := NewRecorder(path, 80, 24, "")
	require.NoError(t, err)
	err = r.Close()
	assert.NoError(t, err)
}

func TestRecorderWriteStdout(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stdout.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	err = r.Write([]byte("hello world"), model.RecordStdout)
	require.NoError(t, err)

	err = r.Close()
	require.NoError(t, err)

	info, _ := os.Stat(path)
	assert.True(t, info.Size() > 0, "file should not be empty")
}

func TestRecorderWriteStdin(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stdin.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	err = r.Write([]byte("ls -la\n"), model.RecordStdin)
	require.NoError(t, err)

	err = r.Close()
	require.NoError(t, err)

	info, _ := os.Stat(path)
	assert.True(t, info.Size() > 0)
}

func TestRecorderWriteMultipleEntries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "multi.msshlog")
	r, err := NewRecorder(path, 100, 30, "vt220")
	require.NoError(t, err)

	entries := []struct {
		data []byte
		typ  model.RecordType
	}{
		{[]byte("output line 1\n"), model.RecordStdout},
		{[]byte("input\n"), model.RecordStdin},
		{[]byte("output line 2\n"), model.RecordStdout},
		{[]byte("exit\n"), model.RecordStdin},
	}

	for _, e := range entries {
		err = r.Write(e.data, e.typ)
		require.NoError(t, err)
	}

	err = r.Close()
	require.NoError(t, err)

	info, _ := os.Stat(path)
	require.True(t, info.Size() > 0)
}

func TestRecorderWriteEmptyData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty_data.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	err = r.Write([]byte{}, model.RecordStdout)
	require.NoError(t, err)

	err = r.Close()
	require.NoError(t, err)
}

func TestRecorderWriteLargeData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	largeData := make([]byte, 65536)
	for i := range largeData {
		largeData[i] = byte(i % 256)
	}
	err = r.Write(largeData, model.RecordStdout)
	require.NoError(t, err)

	err = r.Close()
	require.NoError(t, err)
}

func TestRecorderClose(t *testing.T) {
	path := filepath.Join(t.TempDir(), "close_test.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	err = r.Close()
	require.NoError(t, err)
}

func TestRecorderWriteAfterClose(t *testing.T) {
	path := filepath.Join(t.TempDir(), "after_close.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	err = r.Close()
	require.NoError(t, err)

	err = r.Write([]byte("data"), model.RecordStdout)
	assert.Error(t, err)
}

func TestRecorderBinaryData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "binary.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	binaryData := []byte{0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD}
	err = r.Write(binaryData, model.RecordStdout)
	require.NoError(t, err)

	err = r.Close()
	require.NoError(t, err)
}

func TestRecorderWriteMixedTypes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mixed_types.msshlog")
	r, err := NewRecorder(path, 120, 40, "xterm-256color")
	require.NoError(t, err)

	err = r.Write([]byte("prompt$ "), model.RecordStdout)
	require.NoError(t, err)
	err = r.Write([]byte("ls\n"), model.RecordStdin)
	require.NoError(t, err)
	err = r.Write([]byte("file1 file2\n"), model.RecordStdout)
	require.NoError(t, err)
	err = r.Write([]byte("prompt$ "), model.RecordStdout)
	require.NoError(t, err)

	err = r.Close()
	require.NoError(t, err)
}

func TestRecorderEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty.msshlog")
	r, err := NewRecorder(path, 80, 24, "vt100")
	require.NoError(t, err)

	err = r.Close()
	require.NoError(t, err)

	data, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.True(t, len(data) > 0, "header should be written even with no entries")
}

func TestRecorderFilePermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not expose POSIX file modes")
	}
	path := filepath.Join(t.TempDir(), "perms.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)
	defer func() { _ = r.Close() }()

	info, err := os.Stat(path)
	require.NoError(t, err)
	perm := info.Mode().Perm()
	assert.Equal(t, os.FileMode(0o600), perm)
}
