package service

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestEnsureVersionFileRepairsPermissionsWithoutMutatingHardLinkSource(t *testing.T) {
	requireHardLinks(t)
	root := t.TempDir()
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey,
		WithSyncDataDir(filepath.Join(root, "data")))
	require.NoError(t, service.ensureVersionDirectory())
	content := []byte("private sync version")
	source := filepath.Join(root, "source.msshbackup")
	require.NoError(t, os.WriteFile(source, content, 0o644))
	require.NoError(t, os.Chmod(source, 0o644))
	version := &model.SyncVersion{ID: 1, FileName: "linked.msshbackup", SizeBytes: int64(len(content))}
	versionPath := service.versionFilePath(*version)
	require.NoError(t, os.Link(source, versionPath))

	require.NoError(t, service.ensureVersionFile(version, content))

	assertPrivateReplacementPreservesSource(t, source, versionPath, content)
}

func TestJournalLoadRepairsPermissionsWithoutMutatingHardLinkSource(t *testing.T) {
	requireHardLinks(t)
	root := t.TempDir()
	journal := newTransferFinalizationJournalStore(filepath.Join(root, "data"))
	require.NoError(t, os.MkdirAll(journal.directory, 0o700))
	content := []byte(`{"entries":[]}`)
	source := filepath.Join(root, "source-journal.json")
	require.NoError(t, os.WriteFile(source, content, 0o644))
	require.NoError(t, os.Chmod(source, 0o644))
	require.NoError(t, os.Link(source, journal.path))

	finalizations, err := journal.load()

	require.NoError(t, err)
	assert.Empty(t, finalizations)
	assertPrivateReplacementPreservesSource(t, source, journal.path, content)
}

func TestEnsureVersionFileKeepsPrivateFileIdentity(t *testing.T) {
	root := t.TempDir()
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey,
		WithSyncDataDir(filepath.Join(root, "data")))
	require.NoError(t, service.ensureVersionDirectory())
	content := []byte("already private")
	version := &model.SyncVersion{ID: 1, FileName: "private.msshbackup", SizeBytes: int64(len(content))}
	versionPath := service.versionFilePath(*version)
	require.NoError(t, os.WriteFile(versionPath, content, 0o600))
	before, err := os.Stat(versionPath)
	require.NoError(t, err)

	require.NoError(t, service.ensureVersionFile(version, content))

	after, err := os.Stat(versionPath)
	require.NoError(t, err)
	assert.True(t, os.SameFile(before, after))
}

func TestEnsureVersionFileRejectsSymbolicLinkWithoutChangingTarget(t *testing.T) {
	root := t.TempDir()
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey,
		WithSyncDataDir(filepath.Join(root, "data")))
	require.NoError(t, service.ensureVersionDirectory())
	content := []byte("linked target")
	target := filepath.Join(root, "target.msshbackup")
	require.NoError(t, os.WriteFile(target, content, 0o644))
	version := &model.SyncVersion{ID: 1, FileName: "linked.msshbackup", SizeBytes: int64(len(content))}
	if err := os.Symlink(target, service.versionFilePath(*version)); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}

	err := service.ensureVersionFile(version, content)

	assert.ErrorContains(t, err, "regular file")
	targetInfo, statErr := os.Stat(target)
	require.NoError(t, statErr)
	if runtime.GOOS != "windows" {
		assert.Equal(t, os.FileMode(0o644), targetInfo.Mode().Perm())
	}
	actual, readErr := os.ReadFile(target)
	require.NoError(t, readErr)
	assert.Equal(t, content, actual)
}

func requireHardLinks(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission assertions are unavailable on Windows")
	}
}

func assertPrivateReplacementPreservesSource(t *testing.T, source, replacement string, content []byte) {
	t.Helper()
	sourceInfo, err := os.Stat(source)
	require.NoError(t, err)
	replacementInfo, err := os.Stat(replacement)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o644), sourceInfo.Mode().Perm())
	assert.Equal(t, os.FileMode(0o600), replacementInfo.Mode().Perm())
	assert.False(t, os.SameFile(sourceInfo, replacementInfo))
	actual, err := os.ReadFile(replacement)
	require.NoError(t, err)
	assert.Equal(t, content, actual)
}
