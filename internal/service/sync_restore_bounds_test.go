package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestRestoreVersionRejectsOversizedFileBeforeRestore(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	lifecycle := &fakeSyncLifecycle{}
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()), WithSyncLifecycle(lifecycle))
	version, err := service.saveCurrentVersion(model.SyncProviderGist, "test", false)
	require.NoError(t, err)
	require.NoError(t, os.Truncate(service.versionFilePath(*version), maxCloudBackupSize+1))

	err = service.RestoreVersion(version.ID)

	assert.ErrorContains(t, err, "sync version exceeds")
	assert.Zero(t, lifecycle.calls)
}

func TestRestoreVersionRejectsNonRegularFileBeforeRestore(t *testing.T) {
	tests := []struct {
		name    string
		replace func(*testing.T, string)
	}{
		{name: "directory", replace: replaceVersionWithDirectory},
		{name: "symbolic link", replace: replaceVersionWithSymlink},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			setSyncMasterKey(t, db, syncTestMasterKey)
			lifecycle := &fakeSyncLifecycle{}
			service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()), WithSyncLifecycle(lifecycle))
			version, err := service.saveCurrentVersion(model.SyncProviderGist, "test", false)
			require.NoError(t, err)
			test.replace(t, service.versionFilePath(*version))

			err = service.RestoreVersion(version.ID)

			assert.ErrorContains(t, err, "regular file")
			assert.Zero(t, lifecycle.calls)
		})
	}
}

func replaceVersionWithDirectory(t *testing.T, path string) {
	t.Helper()
	require.NoError(t, os.Remove(path))
	require.NoError(t, os.Mkdir(path, 0o700))
}

func replaceVersionWithSymlink(t *testing.T, path string) {
	t.Helper()
	target := filepath.Join(t.TempDir(), "version.msshbackup")
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(target, content, 0o600))
	require.NoError(t, os.Remove(path))
	if err := os.Symlink(target, path); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
}
