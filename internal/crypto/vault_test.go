package crypto

import (
	"errors"
	"os"
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

func TestSyncSecretFromDEK(t *testing.T) {
	secret := SyncSecretFromDEK([]byte{1, 2, 3, 4})
	assert.NotEmpty(t, secret)
	assert.Equal(t, secret, SyncSecretFromDEK([]byte{1, 2, 3, 4}))
}

func TestValidateVaultFileRejectsBadValues(t *testing.T) {
	assert.Error(t, validateVaultFile(VaultFile{FormatVersion: 99}))
	assert.Error(t, validateVaultFile(VaultFile{FormatVersion: VaultFormatVersion, Cipher: "x", KDF: "Argon2id"}))
	assert.Error(t, validateVaultFile(VaultFile{FormatVersion: VaultFormatVersion, Cipher: "AES-256-GCM", KDF: "Argon2id"}))
	assert.Error(t, validateVaultFile(VaultFile{
		FormatVersion: VaultFormatVersion, Cipher: "AES-256-GCM", KDF: "Argon2id",
		Salt: "s", Nonce: "n", WrappedDEK: "w", ArgonTime: 0, ArgonMemory: 1, ArgonThreads: 1,
	}))
}

func TestLoadVaultFileMissing(t *testing.T) {
	_, err := LoadVaultFile(filepath.Join(t.TempDir(), "missing.json"))
	assert.Error(t, err)
}

func TestSaveVaultFileCreatesDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested")
	vault, _, err := CreateVault("initial-pass-12")
	require.NoError(t, err)
	require.NoError(t, SaveVaultFile(VaultPath(dir), vault))
	loaded, err := LoadVaultFile(VaultPath(dir))
	require.NoError(t, err)
	assert.Equal(t, vault.WrappedDEK, loaded.WrappedDEK)
}

func TestUnlockVaultRejectsShortPassword(t *testing.T) {
	vault, _, err := CreateVault("initial-pass-12")
	require.NoError(t, err)
	_, err = UnlockVault("short", vault)
	assert.Error(t, err)
}

func TestRotateVaultPasswordRejects(t *testing.T) {
	vault, _, err := CreateVault("initial-pass-12")
	require.NoError(t, err)
	_, _, err = RotateVaultPassword("wrong-password12", "next-password12", vault, nil)
	assert.Error(t, err)
	_, _, err = RotateVaultPassword("initial-pass-12", "short", vault, nil)
	assert.Error(t, err)
	_, _, err = RotateVaultPassword("initial-pass-12", "next-password12", vault, func(oldDEK, newDEK []byte) error {
		return errors.New("reencrypt failed")
	})
	assert.Error(t, err)
}

func TestLoadVaultFileInvalidJSONAndValidate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "vault.json")
	require.NoError(t, os.WriteFile(path, []byte("{"), 0o600))
	_, err := LoadVaultFile(path)
	assert.Error(t, err)

	require.NoError(t, os.WriteFile(path, []byte(`{"format_version":1,"cipher":"AES-256-GCM","kdf":"Argon2id","argon_time":1,"argon_memory":1,"argon_threads":1,"salt":"YQ==","nonce":"YQ==","wrapped_dek":"YQ=="}`), 0o600))
	vault, err := LoadVaultFile(path)
	require.NoError(t, err)
	_, err = UnlockVault("initial-pass-12", vault)
	assert.Error(t, err)

	assert.Error(t, InstallVaultFile(t.TempDir(), VaultFile{}))
	assert.Error(t, SaveVaultFile(filepath.Join(t.TempDir(), "v.json"), VaultFile{}))
}

func TestUnwrapRejectsBadBase64Fields(t *testing.T) {
	vault := VaultFile{
		FormatVersion: VaultFormatVersion, Cipher: "AES-256-GCM", KDF: "Argon2id",
		ArgonTime: 1, ArgonMemory: 8, ArgonThreads: 1,
		Salt: "!!!", Nonce: "YQ==", WrappedDEK: "YQ==",
	}
	_, err := UnlockVault("initial-pass-12", vault)
	assert.Error(t, err)
	vault.Salt = "YQ=="
	vault.Nonce = "!!!"
	_, err = UnlockVault("initial-pass-12", vault)
	assert.Error(t, err)
	vault.Nonce = "YQ=="
	vault.WrappedDEK = "!!!"
	_, err = UnlockVault("initial-pass-12", vault)
	assert.Error(t, err)
}
