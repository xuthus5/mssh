package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWritePrivateFileAtomicPreservesExistingParentMode(t *testing.T) {
	root := t.TempDir()
	parent := filepath.Join(root, "exports")
	require.NoError(t, os.Mkdir(parent, 0o755))
	require.NoError(t, os.Chmod(parent, 0o755))

	path := filepath.Join(parent, "sessions.csv")
	require.NoError(t, writePrivateFileAtomic(path, []byte("name,host\n")))

	info, err := os.Stat(parent)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o755), info.Mode().Perm())

	fileInfo, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), fileInfo.Mode().Perm())
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, "name,host\n", string(content))
}

func TestWritePrivateFileAtomicCreatesMissingParentAsPrivate(t *testing.T) {
	root := t.TempDir()
	parent := filepath.Join(root, "nested", "private")
	path := filepath.Join(parent, "backup.msshbak")
	require.NoError(t, writePrivateFileAtomic(path, []byte("payload")))

	info, err := os.Stat(parent)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o700), info.Mode().Perm())
	fileInfo, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), fileInfo.Mode().Perm())
}
