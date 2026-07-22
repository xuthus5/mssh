package crypto

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSaveVaultFileRejectsPathParentFile(t *testing.T) {
	base := t.TempDir()
	parentFile := filepath.Join(base, "as-file")
	require.NoError(t, os.WriteFile(parentFile, []byte("x"), 0o600))
	vault, _, err := CreateVault("initial-pass-12")
	require.NoError(t, err)
	err = SaveVaultFile(filepath.Join(parentFile, "vault.json"), vault)
	assert.Error(t, err)
}

func TestUnwrapDEKRejectsShortNonce(t *testing.T) {
	vault, _, err := CreateVault("initial-pass-12")
	require.NoError(t, err)
	// valid salt, short nonce
	vault.Nonce = base64.StdEncoding.EncodeToString([]byte("short"))
	_, err = UnlockVault("initial-pass-12", vault)
	assert.Error(t, err)
}

func TestCreateVaultRejectsShortPassword(t *testing.T) {
	_, _, err := CreateVault("short")
	assert.Error(t, err)
}

func TestRotateVaultPasswordNilReencrypt(t *testing.T) {
	vault, _, err := CreateVault("initial-pass-12")
	require.NoError(t, err)
	next, newDEK, err := RotateVaultPassword("initial-pass-12", "next-password12", vault, nil)
	require.NoError(t, err)
	unlocked, err := UnlockVault("next-password12", next)
	require.NoError(t, err)
	assert.Equal(t, newDEK, unlocked)
}
