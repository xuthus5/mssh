package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSecurityServiceShutdownWaitsForPostUnlockCallback(t *testing.T) {
	database := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	service := NewSecurityService(database, t.TempDir(), runtime, nil, testutil.NewTestLogger())
	callbackStarted := make(chan struct{})
	releaseCallback := make(chan struct{})
	t.Cleanup(func() { closeChannelIfOpen(releaseCallback) })
	service.SetAfterUnlock(func() {
		close(callbackStarted)
		<-releaseCallback
	})

	setupDone := make(chan error, 1)
	go func() {
		_, err := service.Setup(model.SecuritySetupInput{Password: "shutdown-pass-12", RememberUnlock: false})
		setupDone <- err
	}()
	<-callbackStarted
	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()

	select {
	case <-shutdownDone:
		t.Fatal("security shutdown returned before the post-unlock callback completed")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, database.Ping())
	closeChannelIfOpen(releaseCallback)
	require.NoError(t, <-setupDone)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("security shutdown did not finish after the callback completed")
	}
	assert.ErrorIs(t, runtime.RequireUnlocked(), ErrVaultLocked)
}

func TestSecurityServiceShutdownWaitsForVaultInstallTransaction(t *testing.T) {
	source := NewSecurityService(testutil.NewTestDB(t), t.TempDir(), NewCryptoRuntime(), nil, testutil.NewTestLogger())
	_, err := source.Setup(model.SecuritySetupInput{Password: "transaction-pass-12", RememberUnlock: false})
	require.NoError(t, err)
	vault, err := source.ExportVaultFile()
	require.NoError(t, err)

	targetDatabase := testutil.NewTestDB(t)
	target := NewSecurityService(targetDatabase, t.TempDir(), NewCryptoRuntime(), nil, testutil.NewTestLogger())
	transaction, err := target.PrepareVaultFromExport("transaction-pass-12", vault)
	require.NoError(t, err)
	shutdownDone := make(chan struct{})
	go func() {
		target.Shutdown()
		close(shutdownDone)
	}()

	select {
	case <-shutdownDone:
		t.Fatal("security shutdown returned before the vault transaction closed")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, targetDatabase.Ping())
	require.NoError(t, transaction.Rollback())
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("security shutdown did not finish after the vault transaction rolled back")
	}
}

func TestSecurityServiceRejectsOperationsAfterShutdown(t *testing.T) {
	service := NewSecurityService(testutil.NewTestDB(t), t.TempDir(), NewCryptoRuntime(), nil, testutil.NewTestLogger())
	service.Shutdown()
	service.Shutdown()

	_, err := service.Status()
	assertSecurityServiceStopped(t, err)
	assertSecurityServiceStopped(t, service.VerifyPassword("password"))
	_, err = service.Setup(model.SecuritySetupInput{})
	assertSecurityServiceStopped(t, err)
	_, err = service.Unlock(model.SecurityUnlockInput{})
	assertSecurityServiceStopped(t, err)
	_, err = service.Lock()
	assertSecurityServiceStopped(t, err)
	_, err = service.Rotate(model.SecurityRotateInput{})
	assertSecurityServiceStopped(t, err)
	_, err = service.SavePreferences(model.SecurityPreferenceInput{})
	assertSecurityServiceStopped(t, err)
	assertSecurityServiceStopped(t, service.TryAutoUnlock())
	assertSecurityServiceStopped(t, service.RecoverPendingRotation())
	_, err = service.SyncSecret()
	assertSecurityServiceStopped(t, err)
	_, err = service.ExportVaultFile()
	assertSecurityServiceStopped(t, err)
	assertSecurityServiceStopped(t, service.InstallVaultFromExport("", crypto.VaultFile{}))
	_, err = service.PrepareVaultFromExport("", crypto.VaultFile{})
	assertSecurityServiceStopped(t, err)
	assertSecurityServiceStopped(t, service.RequireUnlocked())
	assert.NotPanics(t, service.ClearMemory)
}

func TestSecurityServiceShutdownHandlesNilReceiver(t *testing.T) {
	var service *SecurityService
	assert.NotPanics(t, service.Shutdown)
}

func assertSecurityServiceStopped(t *testing.T, err error) {
	t.Helper()
	require.Error(t, err)
	assert.ErrorContains(t, err, "security service is shutting down")
}

func closeChannelIfOpen(channel chan struct{}) {
	select {
	case <-channel:
	default:
		close(channel)
	}
}
