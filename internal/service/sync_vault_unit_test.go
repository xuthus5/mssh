package service

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSyncServiceMasterKeyAndArtifactVault(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())
	_, err := svc.masterKey()
	assert.Error(t, err)

	vault, _, err := backupcrypto.CreateVault("initial-pass-12")
	require.NoError(t, err)
	svc = NewSyncService(db, testutil.NewTestLogger(),
		WithSyncSecretSource(func() (string, error) { return "", nil }),
		WithVaultSource(func() (*backupcrypto.VaultFile, error) { return &vault, nil }),
	)
	_, err = svc.masterKey()
	assert.Error(t, err)

	svc = NewSyncService(db, testutil.NewTestLogger(),
		WithSyncSecretSource(func() (string, error) { return "secret-from-vault", nil }),
		WithVaultSource(func() (*backupcrypto.VaultFile, error) { return &vault, nil }),
	)
	key, err := svc.masterKey()
	require.NoError(t, err)
	assert.Equal(t, "secret-from-vault", key)
	got, err := svc.artifactVault()
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, vault.WrappedDEK, got.WrappedDEK)

	svc = NewSyncService(db, testutil.NewTestLogger(),
		WithSyncSecretSource(func() (string, error) { return "", errors.New("locked") }),
		WithVaultSource(func() (*backupcrypto.VaultFile, error) { return nil, errors.New("export failed") }),
	)
	_, err = svc.masterKey()
	assert.Error(t, err)
	_, err = svc.artifactVault()
	assert.Error(t, err)

	svc = NewSyncService(db, testutil.NewTestLogger(), WithVaultSource(func() (*backupcrypto.VaultFile, error) { return nil, nil }))
	got, err = svc.artifactVault()
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestSyncServiceAdoptVaultFromContent(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())
	assert.Error(t, svc.AdoptVaultFromContent("initial-pass-12", []byte("nope")))

	installed := false
	vault, _, err := backupcrypto.CreateVault("initial-pass-12")
	require.NoError(t, err)
	// Build a minimal sync artifact with vault envelope via encode helpers if available.
	// Fall back to Adopt with peek failure when content invalid.
	svc = NewSyncService(db, testutil.NewTestLogger(),
		WithVaultInstaller(func(password string, v backupcrypto.VaultFile) error {
			installed = true
			assert.Equal(t, "initial-pass-12", password)
			assert.Equal(t, vault.WrappedDEK, v.WrappedDEK)
			return nil
		}),
	)
	// invalid content -> missing vault
	assert.ErrorIs(t, svc.AdoptVaultFromContent("initial-pass-12", []byte("{")), errSyncVaultMissing)
	assert.False(t, installed)
}

func TestSyncServiceImportWithPasswordMissingFile(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger(),
		WithVaultInstaller(func(string, backupcrypto.VaultFile) error { return nil }),
	)
	err := svc.ImportWithPassword(filepath.Join(t.TempDir(), "missing.msshbackup"), "initial-pass-12")
	assert.Error(t, err)
}

func TestSyncServiceInstallJoinVaultAndConfigErrors(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger(),
		WithVaultInstaller(func(string, backupcrypto.VaultFile) error { return errors.New("bad vault") }),
	)
	err := svc.installJoinVaultAndConfig(model.SyncConfigInput{}, "initial-pass-12", []byte("x"))
	assert.Error(t, err)
}

func TestSyncServiceRestoreJoinSnapshotRequiresMasterKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())
	err := svc.restoreJoinSnapshot([]byte("x"))
	assert.Error(t, err)
}

func TestWritePrivateFileAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "file.bin")
	require.NoError(t, writePrivateFileAtomic(path, []byte("payload")))
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, "payload", string(content))
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
}
