package service

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

type stubVaultInstallTransaction struct {
	operation func(func() error) error
	commit    func() error
	rollback  func() error
}

func (t *stubVaultInstallTransaction) WithCryptoOperation(operation func() error) error {
	if t.operation != nil {
		return t.operation(operation)
	}
	return operation()
}

func (t *stubVaultInstallTransaction) Commit() error {
	if t.commit == nil {
		return nil
	}
	return t.commit()
}

func (t *stubVaultInstallTransaction) Rollback() error {
	if t.rollback == nil {
		return nil
	}
	return t.rollback()
}

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
		WithVaultTransactionInstaller(func(password string, v backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			installed = true
			assert.Equal(t, "initial-pass-12", password)
			assert.Equal(t, vault.WrappedDEK, v.WrappedDEK)
			return &stubVaultInstallTransaction{}, nil
		}),
	)
	// malformed content must remain distinguishable from a legacy artifact.
	assert.Error(t, svc.AdoptVaultFromContent("initial-pass-12", []byte("{")))
	assert.False(t, installed)
}

func TestSyncServiceAdoptVaultRollsBackWhenCommitFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	password := "adopt-rollback-pass-12"
	vault, dek, err := backupcrypto.CreateVault(password)
	require.NoError(t, err)
	secret := backupcrypto.SyncSecretFromDEK(dek)
	rolledBack := false
	svc := newTestSyncService(db, secret,
		WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{
				commit:   func() error { return assert.AnError },
				rollback: func() error { rolledBack = true; return nil },
			}, nil
		}),
	)
	data, err := svc.snapshot()
	require.NoError(t, err)
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, secret, syncArtifactMetadata{SnapshotFingerprint: fingerprint}, &vault)
	require.NoError(t, err)

	err = svc.AdoptVaultFromContent(password, content)
	require.ErrorIs(t, err, assert.AnError)
	assert.True(t, rolledBack)
}

func TestSyncServiceImportWithPasswordMissingFile(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())
	err := svc.ImportWithPassword(filepath.Join(t.TempDir(), "missing.msshbackup"), "initial-pass-12")
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
