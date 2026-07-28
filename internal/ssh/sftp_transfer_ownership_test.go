package ssh

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUploadFileExclusiveContextWithOwnershipRejectsExistingTarget(t *testing.T) {
	address, cleanup := startSFTPServer(t)
	t.Cleanup(cleanup)
	wrapper, client := connectSFTP(t, address)
	cleanupOwnershipSFTPClient(t, wrapper, client)
	seedRemoteOwnershipFile(t, client, "/existing", "original")
	source := filepath.Join(t.TempDir(), "source")
	require.NoError(t, os.WriteFile(source, []byte("replacement"), 0o600))

	owned, err := UploadFileExclusiveContextWithOwnership(
		context.Background(), client, source, "/existing", nil,
	)

	assert.False(t, owned)
	require.Error(t, err)
	assert.Equal(t, "original", readRemoteOwnershipFile(t, client, "/existing"))
}

func TestUploadFileExclusiveContextWithOwnershipReportsCreatedPartial(t *testing.T) {
	address, cleanup := startSFTPServer(t)
	t.Cleanup(cleanup)
	wrapper, client := connectSFTP(t, address)
	cleanupOwnershipSFTPClient(t, wrapper, client)
	source := filepath.Join(t.TempDir(), "source")
	require.NoError(t, os.WriteFile(source, []byte("data"), 0o600))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	owned, err := UploadFileExclusiveContextWithOwnership(ctx, client, source, "/partial", nil)

	assert.True(t, owned)
	require.ErrorIs(t, err, context.Canceled)
	_, statErr := client.Stat("/partial")
	assert.NoError(t, statErr)
}

func TestDownloadFileExclusiveContextWithOwnershipRejectsExistingTarget(t *testing.T) {
	address, cleanup := startSFTPServer(t)
	t.Cleanup(cleanup)
	wrapper, client := connectSFTP(t, address)
	cleanupOwnershipSFTPClient(t, wrapper, client)
	seedRemoteOwnershipFile(t, client, "/source", "replacement")
	target := filepath.Join(t.TempDir(), "existing")
	require.NoError(t, os.WriteFile(target, []byte("original"), 0o600))

	owned, err := DownloadFileExclusiveContextWithOwnership(
		context.Background(), client, "/source", target, nil,
	)

	assert.False(t, owned)
	require.Error(t, err)
	data, readErr := os.ReadFile(target)
	require.NoError(t, readErr)
	assert.Equal(t, "original", string(data))
}

func TestDownloadFileExclusiveContextWithOwnershipReportsCreatedPartial(t *testing.T) {
	address, cleanup := startSFTPServer(t)
	t.Cleanup(cleanup)
	wrapper, client := connectSFTP(t, address)
	cleanupOwnershipSFTPClient(t, wrapper, client)
	seedRemoteOwnershipFile(t, client, "/source", "data")
	target := filepath.Join(t.TempDir(), "partial")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	owned, err := DownloadFileExclusiveContextWithOwnership(ctx, client, "/source", target, nil)

	assert.True(t, owned)
	require.ErrorIs(t, err, context.Canceled)
	_, statErr := os.Stat(target)
	assert.NoError(t, statErr)
}

func seedRemoteOwnershipFile(t *testing.T, client *SFTPClient, path, content string) {
	t.Helper()
	file, err := client.Create(path)
	require.NoError(t, err)
	_, writeErr := file.Write([]byte(content))
	require.NoError(t, writeErr)
	require.NoError(t, file.Close())
}

func readRemoteOwnershipFile(t *testing.T, client *SFTPClient, path string) string {
	t.Helper()
	file, err := client.Open(path)
	require.NoError(t, err)
	data, readErr := io.ReadAll(file)
	require.NoError(t, readErr)
	require.NoError(t, file.Close())
	return string(data)
}

func cleanupOwnershipSFTPClient(t *testing.T, wrapper *ClientWrapper, client *SFTPClient) {
	t.Helper()
	t.Cleanup(func() {
		assert.NoError(t, client.Close())
		assert.NoError(t, wrapper.Close())
	})
}
