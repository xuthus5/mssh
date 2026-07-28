package service

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

type failingSetKeychain struct{ memoryKeychain }

func (f *failingSetKeychain) Set(string, string, []byte) error {
	return errors.New("set failed")
}

type failingGetKeychain struct{ memoryKeychain }

func (f *failingGetKeychain) Get(string, string) ([]byte, error) {
	return nil, errors.New("get failed")
}

func TestSecurityAfterUnlockHookRunsOutsideStateLock(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSecurityService(db, t.TempDir(), NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	hookDone := make(chan error, 1)
	service.SetAfterUnlock(func() {
		_, err := service.SavePreferences(model.SecurityPreferenceInput{RememberUnlock: false})
		hookDone <- err
	})
	setupDone := make(chan error, 1)
	go func() {
		_, err := service.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: false})
		setupDone <- err
	}()

	select {
	case err := <-setupDone:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("setup deadlocked while after-unlock hook re-entered security service")
	}
	select {
	case err := <-hookDone:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("after-unlock hook did not finish")
	}
}

func TestSecurityAfterUnlockHookConcurrentRegistration(t *testing.T) {
	service := NewSecurityService(testutil.NewTestDB(t), t.TempDir(), NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	var waitGroup sync.WaitGroup
	for index := 0; index < 100; index++ {
		waitGroup.Add(2)
		go func() {
			defer waitGroup.Done()
			service.SetAfterUnlock(func() {})
		}()
		go func() {
			defer waitGroup.Done()
			service.runAfterUnlock()
		}()
	}
	waitGroup.Wait()
}

func TestSecuritySetupDisablesRememberUnlockWhenKeychainWriteFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	service := NewSecurityService(db, t.TempDir(), runtime, &failingSetKeychain{}, testutil.NewTestLogger())

	status, err := service.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: true})

	require.NoError(t, err)
	assert.True(t, status.Configured)
	assert.True(t, status.Unlocked)
	assert.False(t, status.RememberUnlock)
	require.NoError(t, runtime.RequireUnlocked())
}

func TestSecurityLockDisablesRememberUnlockWhenKeychainDeleteFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	keychain := &memoryKeychain{}
	service := NewSecurityService(db, t.TempDir(), runtime, keychain, testutil.NewTestLogger())
	_, err := service.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: true})
	require.NoError(t, err)
	service.keychain = &failingDeleteKeychain{memoryKeychain: *keychain}

	status, err := service.Lock()

	require.NoError(t, err)
	assert.False(t, status.Unlocked)
	assert.False(t, status.RememberUnlock)
	assert.ErrorIs(t, runtime.RequireUnlocked(), ErrVaultLocked)
}

func TestSecurityTryAutoUnlockReportsKeychainReadFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	service := NewSecurityService(db, t.TempDir(), runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := service.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: true})
	require.NoError(t, err)
	runtime.Clear()
	service.keychain = &failingGetKeychain{}

	err = service.TryAutoUnlock()

	require.Error(t, err)
	assert.ErrorContains(t, err, "read remembered vault fingerprint")
	assert.ErrorIs(t, runtime.RequireUnlocked(), ErrVaultLocked)
}
