package service

import (
	"bytes"
	"database/sql"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type blockingKeyCrypto struct {
	runtime     *CryptoRuntime
	started     chan struct{}
	release     chan struct{}
	startedOnce sync.Once
}

type emptyKeyFilePicker struct{}

func (emptyKeyFilePicker) SelectPrivateKey(string) (string, error) { return "", nil }

func newBlockingKeyCrypto(runtime *CryptoRuntime) *blockingKeyCrypto {
	return &blockingKeyCrypto{
		runtime: runtime,
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
}

func (crypto *blockingKeyCrypto) WithCryptoOperation(operation func() error) error {
	return crypto.runtime.WithCryptoOperation(operation)
}

func (crypto *blockingKeyCrypto) Encrypt(plaintext []byte) ([]byte, error) {
	return crypto.runtime.Encrypt(plaintext)
}

func (crypto *blockingKeyCrypto) Decrypt(ciphertext []byte) ([]byte, error) {
	crypto.startedOnce.Do(func() { close(crypto.started) })
	<-crypto.release
	return crypto.runtime.Decrypt(ciphertext)
}

func TestKeyServiceShutdownWaitsForActiveMaterialRead(t *testing.T) {
	database := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	runtime.SetDEK(bytes.Repeat([]byte{4}, 32))
	stored := createEncryptedTestKey(t, database, runtime, "shutdown-private-key")
	crypto := newBlockingKeyCrypto(runtime)
	t.Cleanup(func() { closeChannelIfOpen(crypto.release) })
	service := NewKeyService(database, crypto, testutil.NewTestLogger())

	materialDone := make(chan *model.SSHKeyMaterial, 1)
	errorDone := make(chan error, 1)
	go func() {
		material, err := service.GetMaterial(stored.ID)
		materialDone <- material
		errorDone <- err
	}()
	<-crypto.started

	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()
	select {
	case <-shutdownDone:
		t.Fatal("key shutdown returned before the material read completed")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, database.Ping())
	require.NoError(t, runtime.RequireUnlocked())

	closeChannelIfOpen(crypto.release)
	require.NoError(t, <-errorDone)
	assert.Equal(t, "shutdown-private-key", (<-materialDone).PrivateKey)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("key shutdown did not finish after the material read completed")
	}
	require.NoError(t, database.Ping())
	require.NoError(t, runtime.RequireUnlocked())
}

func TestKeyServiceRejectsAllOperationsAfterShutdown(t *testing.T) {
	service := NewKeyService(testutil.NewTestDB(t), nil, testutil.NewTestLogger())
	service.Shutdown()
	service.Shutdown()

	_, err := service.List()
	assertKeyServiceStopped(t, err)
	_, err = service.Generate("", model.KeyTypeRSA, 0)
	assertKeyServiceStopped(t, err)
	_, err = service.Import("", "")
	assertKeyServiceStopped(t, err)
	assertKeyServiceStopped(t, service.Delete(0))
	_, err = service.UsageCount(0)
	assertKeyServiceStopped(t, err)
	_, err = service.ExportPublicKey(0)
	assertKeyServiceStopped(t, err)
	_, err = service.GetMaterial(0)
	assertKeyServiceStopped(t, err)
	_, err = service.Update(model.SSHKeyUpdateInput{})
	assertKeyServiceStopped(t, err)
	_, err = service.SelectImportFile()
	assertKeyServiceStopped(t, err)
}

func TestKeyServiceShutdownHandlesNilReceiver(t *testing.T) {
	var service *KeyService
	assert.NotPanics(t, service.Shutdown)
	_, err := service.List()
	assertKeyServiceStopped(t, err)
}

func TestKeyServiceFilePickerAccessIsConcurrentSafe(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	service := NewKeyService(nil, nil, testutil.NewTestLogger())
	service.SetFilePicker(emptyKeyFilePicker{})
	var workers sync.WaitGroup
	workers.Add(2)
	go func() {
		defer workers.Done()
		for range 100 {
			service.SetFilePicker(emptyKeyFilePicker{})
		}
	}()
	go func() {
		defer workers.Done()
		for range 100 {
			_, _ = service.SelectImportFile()
		}
	}()
	workers.Wait()
}

func createEncryptedTestKey(t *testing.T, database *sql.DB, crypto KeyCrypto, privateKey string) *model.SSHKey {
	t.Helper()
	encrypted, err := crypto.Encrypt([]byte(privateKey))
	require.NoError(t, err)
	key, err := store.CreateKey(database, model.SSHKey{
		Name: "shutdown-key", Type: model.KeyTypeED25519,
		PrivateKey: string(encrypted), PublicKey: "ssh-ed25519 shutdown-key",
	})
	require.NoError(t, err)
	return key
}

func assertKeyServiceStopped(t *testing.T, err error) {
	t.Helper()
	require.Error(t, err)
	assert.ErrorContains(t, err, "key service is shutting down")
}
