package fsutil

import (
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenRegularFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "input")
	require.NoError(t, os.WriteFile(path, []byte("payload"), 0o600))

	file, info, err := OpenRegularFile(path)
	require.NoError(t, err)
	content, err := io.ReadAll(file)
	require.NoError(t, err)
	require.NoError(t, file.Close())
	assert.Equal(t, "payload", string(content))
	assert.True(t, info.Mode().IsRegular())
}

func TestOpenRegularFileRejectsNonRegularPath(t *testing.T) {
	file, info, err := OpenRegularFile(t.TempDir())

	assert.Nil(t, file)
	assert.Nil(t, info)
	require.Error(t, err)
	assert.ErrorContains(t, err, "regular file")
}

func TestOpenRegularFileSymlinkPolicy(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	directory := t.TempDir()
	target := filepath.Join(directory, "target")
	require.NoError(t, os.WriteFile(target, []byte("payload"), 0o600))
	link := filepath.Join(directory, "link")
	require.NoError(t, os.Symlink(target, link))

	file, _, err := OpenRegularFile(link)
	assert.Nil(t, file)
	require.Error(t, err)

	file, _, err = OpenRegularFileFollowingSymlinks(link)
	require.NoError(t, err)
	content, err := io.ReadAll(file)
	require.NoError(t, err)
	require.NoError(t, file.Close())
	assert.Equal(t, "payload", string(content))
}
