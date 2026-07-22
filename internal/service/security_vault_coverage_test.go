package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSecurityExportInstallVaultRoundTrip(t *testing.T) {
	db := testutil.NewTestDB(t)
	dirA := t.TempDir()
	dirB := t.TempDir()
	runtimeA := NewCryptoRuntime()
	runtimeB := NewCryptoRuntime()
	svcA := NewSecurityService(db, dirA, runtimeA, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := svcA.Setup(model.SecuritySetupInput{Password: "initial-pass-12"})
	require.NoError(t, err)
	vault, err := svcA.ExportVaultFile()
	require.NoError(t, err)

	dbB := testutil.NewTestDB(t)
	svcB := NewSecurityService(dbB, dirB, runtimeB, &memoryKeychain{}, testutil.NewTestLogger())
	require.NoError(t, svcB.InstallVaultFromExport("initial-pass-12", vault))
	assert.True(t, crypto.VaultExists(dirB))
	status, err := svcB.Unlock(model.SecurityUnlockInput{Password: "initial-pass-12"})
	require.NoError(t, err)
	assert.True(t, status.Unlocked)
}
