package fsutil

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenRegularFileForAppendWritesAtEnd(t *testing.T) {
	path := filepath.Join(t.TempDir(), "append.log")
	require.NoError(t, os.WriteFile(path, []byte("before"), 0o600))

	file, info, err := OpenRegularFileForAppend(path)
	require.NoError(t, err)
	require.Equal(t, int64(len("before")), info.Size())
	_, err = file.WriteString("after")
	require.NoError(t, err)
	require.NoError(t, file.Close())

	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, "beforeafter", string(content))
}

func TestOpenRegularFileForAppendRejectsSymbolicLink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	directory := t.TempDir()
	target := filepath.Join(directory, "target")
	require.NoError(t, os.WriteFile(target, []byte("keep"), 0o600))
	path := filepath.Join(directory, "link")
	require.NoError(t, os.Symlink(target, path))

	file, _, err := OpenRegularFileForAppend(path)

	assert.Nil(t, file)
	assert.ErrorContains(t, err, "regular file")
}

func TestCreateRegularFileForAppendIsExclusive(t *testing.T) {
	path := filepath.Join(t.TempDir(), "append.log")
	require.NoError(t, os.WriteFile(path, []byte("keep"), 0o600))

	file, _, err := CreateRegularFileForAppend(path, 0o600)

	assert.Nil(t, file)
	assert.ErrorIs(t, err, os.ErrExist)
	content, readErr := os.ReadFile(path)
	require.NoError(t, readErr)
	assert.Equal(t, "keep", string(content))
}

func TestCreateRegularFileForAppendCreatesPrivateFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("permission bits differ on Windows")
	}
	path := filepath.Join(t.TempDir(), "append.log")

	file, info, err := CreateRegularFileForAppend(path, 0o600)
	require.NoError(t, err)
	require.True(t, info.Mode().IsRegular())
	require.NoError(t, file.Close())

	created, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), created.Mode().Perm())
}
