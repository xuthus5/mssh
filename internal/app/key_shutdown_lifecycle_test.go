package app

import (
	"bytes"
	"database/sql"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/store"
)

type blockingAppKeyCrypto struct {
	runtime     *service.CryptoRuntime
	started     chan struct{}
	release     chan struct{}
	startedOnce sync.Once
	releaseOnce sync.Once
}

type appKeyShutdownFixture struct {
	database *sql.DB
	runtime  *service.CryptoRuntime
	crypto   *blockingAppKeyCrypto
	key      *service.KeyService
	security *service.SecurityService
	storedID int64
}

type appKeyMaterialResult struct {
	material *model.SSHKeyMaterial
	err      error
}

func newBlockingAppKeyCrypto(runtime *service.CryptoRuntime) *blockingAppKeyCrypto {
	return &blockingAppKeyCrypto{
		runtime: runtime,
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
}

func (crypto *blockingAppKeyCrypto) WithCryptoOperation(operation func() error) error {
	return crypto.runtime.WithCryptoOperation(operation)
}

func (crypto *blockingAppKeyCrypto) Encrypt(plaintext []byte) ([]byte, error) {
	return crypto.runtime.Encrypt(plaintext)
}

func (crypto *blockingAppKeyCrypto) Decrypt(ciphertext []byte) ([]byte, error) {
	crypto.startedOnce.Do(func() { close(crypto.started) })
	<-crypto.release
	return crypto.runtime.Decrypt(ciphertext)
}

func (crypto *blockingAppKeyCrypto) releaseRead() {
	crypto.releaseOnce.Do(func() { close(crypto.release) })
}

func TestAppShutdownWaitsForKeysBeforeSecurityAndDatabase(t *testing.T) {
	fixture := newAppKeyShutdownFixture(t)
	materialDone := make(chan appKeyMaterialResult, 1)
	go func() {
		material, err := fixture.key.GetMaterial(fixture.storedID)
		materialDone <- appKeyMaterialResult{material: material, err: err}
	}()
	<-fixture.crypto.started

	shutdownDone := make(chan struct{})
	go func() {
		(&App{
			DB: fixture.database, Key: fixture.key, Security: fixture.security, logger: DefaultTestLogger(t),
		}).Shutdown()
		close(shutdownDone)
	}()
	assertShutdownPending(t, shutdownDone, "active key operation")
	require.NoError(t, fixture.database.Ping())
	require.NoError(t, fixture.runtime.RequireUnlocked())

	fixture.crypto.releaseRead()
	result := <-materialDone
	require.NoError(t, result.err)
	assert.Equal(t, "app-shutdown-private-key", result.material.PrivateKey)
	assertShutdownCompleted(t, shutdownDone, "key operation")
	assert.Error(t, fixture.database.Ping())
	assert.ErrorIs(t, fixture.runtime.RequireUnlocked(), service.ErrVaultLocked)
	_, err := fixture.key.List()
	require.ErrorContains(t, err, "key service is shutting down")
}

func newAppKeyShutdownFixture(t *testing.T) appKeyShutdownFixture {
	t.Helper()
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	runtime := service.NewCryptoRuntime()
	runtime.SetDEK(bytes.Repeat([]byte{8}, 32))
	encrypted, err := runtime.Encrypt([]byte("app-shutdown-private-key"))
	require.NoError(t, err)
	stored, err := store.CreateKey(database, model.SSHKey{
		Name: "app-shutdown-key", Type: model.KeyTypeED25519,
		PrivateKey: string(encrypted), PublicKey: "ssh-ed25519 app-shutdown-key",
	})
	require.NoError(t, err)
	crypto := newBlockingAppKeyCrypto(runtime)
	t.Cleanup(crypto.releaseRead)
	keyService := service.NewKeyService(database, crypto, DefaultTestLogger(t))
	securityService := service.NewSecurityService(database, t.TempDir(), runtime, nil, DefaultTestLogger(t))
	return appKeyShutdownFixture{
		database: database, runtime: runtime, crypto: crypto,
		key: keyService, security: securityService, storedID: stored.ID,
	}
}

func assertShutdownPending(t *testing.T, shutdownDone <-chan struct{}, operation string) {
	t.Helper()
	select {
	case <-shutdownDone:
		t.Fatalf("app shutdown returned before the %s completed", operation)
	case <-time.After(50 * time.Millisecond):
	}
}

func assertShutdownCompleted(t *testing.T, shutdownDone <-chan struct{}, operation string) {
	t.Helper()
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatalf("app shutdown did not finish after the %s completed", operation)
	}
}
