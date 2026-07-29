package crypto

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
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

func TestSaveVaultFileOverwritesExistingVault(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, VaultFileName)
	first, _, err := CreateVault("first-password-12")
	require.NoError(t, err)
	second, _, err := CreateVault("second-password")
	require.NoError(t, err)
	require.NoError(t, SaveVaultFile(path, first))
	require.NoError(t, SaveVaultFile(path, second))

	loaded, err := LoadVaultFile(path)
	require.NoError(t, err)
	require.Equal(t, second.WrappedDEK, loaded.WrappedDEK)
}

func TestValidateAppPassword(t *testing.T) {
	tests := []struct {
		name     string
		password string
		wantErr  bool
	}{
		{name: "too short", password: "short", wantErr: true},
		{name: "invalid UTF-8", password: strings.Repeat("\xff", MinAppPasswordLen), wantErr: true},
		{name: "UTF-8 characters below minimum", password: strings.Repeat("密", 6), wantErr: true},
		{name: "minimum accepted", password: "twelve chars"},
		{name: "UTF-8 minimum accepted", password: strings.Repeat("密", MinAppPasswordLen)},
		{name: "maximum accepted", password: strings.Repeat("x", MaxAppPasswordBytes)},
		{name: "ASCII over maximum", password: strings.Repeat("x", MaxAppPasswordBytes+1), wantErr: true},
		{name: "UTF-8 over maximum", password: strings.Repeat("密", 342), wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateAppPassword(test.password)
			if test.wantErr {
				assert.Error(t, err)
				return
			}
			assert.NoError(t, err)
		})
	}
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
	assert.Error(t, validateVaultFile(VaultFile{Cipher: "x", KDF: "Argon2id"}))
	assert.Error(t, validateVaultFile(VaultFile{Cipher: "AES-256-GCM", KDF: "Argon2id"}))
	assert.Error(t, validateVaultFile(VaultFile{
		Cipher: "AES-256-GCM", KDF: "Argon2id",
		Salt: "s", Nonce: "n", WrappedDEK: "w", ArgonTime: 0, ArgonMemory: 1, ArgonThreads: 1,
	}))
}

func TestLoadVaultFileMissing(t *testing.T) {
	_, err := LoadVaultFile(filepath.Join(t.TempDir(), "missing.json"))
	assert.Error(t, err)
}

func TestLoadVaultFileRejectsOversizedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "vault.json")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o600)
	require.NoError(t, err)
	require.NoError(t, file.Truncate(maxVaultFileBytes+1))
	require.NoError(t, file.Close())

	_, err = LoadVaultFile(path)

	require.Error(t, err)
	assert.ErrorContains(t, err, "vault file exceeds")
}

func TestLoadVaultFileRejectsNonRegularPath(t *testing.T) {
	_, err := LoadVaultFile(t.TempDir())

	require.Error(t, err)
	assert.ErrorContains(t, err, "not a regular file")
}

func TestLoadVaultFileRejectsSymbolicLink(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target.json")
	require.NoError(t, os.WriteFile(target, []byte("{}"), 0o600))
	link := filepath.Join(directory, "vault.json")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}

	_, err := LoadVaultFile(link)

	require.Error(t, err)
	assert.ErrorContains(t, err, "regular file")
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

	require.NoError(t, os.WriteFile(path, []byte(`{"cipher":"AES-256-GCM","kdf":"Argon2id","argon_time":1,"argon_memory":1,"argon_threads":1,"salt":"YQ==","nonce":"YQ==","wrapped_dek":"YQ=="}`), 0o600))
	_, err = LoadVaultFile(path)
	assert.ErrorContains(t, err, "unsupported vault KDF parameters")

	assert.Error(t, InstallVaultFile(t.TempDir(), VaultFile{}))
	assert.Error(t, SaveVaultFile(filepath.Join(t.TempDir(), "v.json"), VaultFile{}))
}

func TestUnwrapRejectsBadBase64Fields(t *testing.T) {
	vault, _, err := CreateVault("initial-pass-12")
	require.NoError(t, err)
	valid := vault
	vault.Salt = "!!!"
	_, err = UnlockVault("initial-pass-12", vault)
	assert.ErrorContains(t, err, "decode vault salt")
	vault = valid
	vault.Nonce = "!!!"
	_, err = UnlockVault("initial-pass-12", vault)
	assert.ErrorContains(t, err, "decode vault nonce")
	vault = valid
	vault.WrappedDEK = "!!!"
	_, err = UnlockVault("initial-pass-12", vault)
	assert.ErrorContains(t, err, "decode wrapped DEK")
}

func TestUnlockVaultRejectsUnsupportedKDFParameters(t *testing.T) {
	vault, _, err := CreateVault("initial-pass-12")
	require.NoError(t, err)
	vault.ArgonTime--

	_, err = UnlockVault("initial-pass-12", vault)

	require.Error(t, err)
	assert.ErrorContains(t, err, "unsupported vault KDF parameters")
}

func TestUnlockVaultRejectsInvalidFieldLengthsBeforeKDF(t *testing.T) {
	vault, _, err := CreateVault("initial-pass-12")
	require.NoError(t, err)
	tests := []struct {
		name   string
		mutate func(*VaultFile)
		want   string
	}{
		{name: "salt", mutate: func(item *VaultFile) { item.Salt = base64.StdEncoding.EncodeToString([]byte("short")) }, want: "invalid vault salt length"},
		{name: "nonce", mutate: func(item *VaultFile) { item.Nonce = base64.StdEncoding.EncodeToString([]byte("short")) }, want: "invalid vault nonce length"},
		{name: "wrapped DEK", mutate: func(item *VaultFile) { item.WrappedDEK = base64.StdEncoding.EncodeToString([]byte("short")) }, want: "invalid wrapped DEK length"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := vault
			test.mutate(&candidate)
			_, unlockErr := UnlockVault("initial-pass-12", candidate)
			require.Error(t, unlockErr)
			assert.ErrorContains(t, unlockErr, test.want)
		})
	}
}
