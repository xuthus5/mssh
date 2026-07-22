package crypto

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVaultCreateUnlockRoundTrip(t *testing.T) {
	vault, dek, err := CreateVault("correct horse battery staple")
	require.NoError(t, err)
	require.Len(t, dek, 32)

	unlocked, err := UnlockVault("correct horse battery staple", vault)
	require.NoError(t, err)
	assert.Equal(t, dek, unlocked)

	_, err = UnlockVault("wrong password!!", vault)
	require.Error(t, err)
}

func TestVaultRotateReencryptsWithNewDEK(t *testing.T) {
	vault, oldDEK, err := CreateVault("old-password-12")
	require.NoError(t, err)

	var sawOld, sawNew []byte
	next, newDEK, err := RotateVaultPassword("old-password-12", "new-password-12", vault, func(oldKey, newKey []byte) error {
		sawOld = append([]byte(nil), oldKey...)
		sawNew = append([]byte(nil), newKey...)
		return nil
	})
	require.NoError(t, err)
	assert.Equal(t, oldDEK, sawOld)
	assert.Equal(t, newDEK, sawNew)
	assert.NotEqual(t, oldDEK, newDEK)

	unlocked, err := UnlockVault("new-password-12", next)
	require.NoError(t, err)
	assert.Equal(t, newDEK, unlocked)

	_, err = UnlockVault("old-password-12", next)
	require.Error(t, err)
}

func TestVaultSaveLoad(t *testing.T) {
	dir := t.TempDir()
	vault, dek, err := CreateVault("save-load-pass-12")
	require.NoError(t, err)
	path := filepath.Join(dir, VaultFileName)
	require.NoError(t, SaveVaultFile(path, vault))

	loaded, err := LoadVaultFile(path)
	require.NoError(t, err)
	unlocked, err := UnlockVault("save-load-pass-12", loaded)
	require.NoError(t, err)
	assert.Equal(t, dek, unlocked)
}

func TestValidateAppPassword(t *testing.T) {
	assert.Error(t, ValidateAppPassword("short"))
	assert.NoError(t, ValidateAppPassword("twelve chars"))
}

func TestInstallVaultFile(t *testing.T) {
	dir := t.TempDir()
	vault, _, err := CreateVault("initial-pass-12")
	require.NoError(t, err)
	require.NoError(t, InstallVaultFile(dir, vault))
	assert.True(t, VaultExists(dir))
	loaded, err := LoadVaultFile(VaultPath(dir))
	require.NoError(t, err)
	assert.Equal(t, vault.WrappedDEK, loaded.WrappedDEK)
}
