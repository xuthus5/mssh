package app

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	err := os.MkdirAll(dataDir, 0o700)
	require.NoError(t, err)

	appInstance, err := New(Options{DataDir: dataDir})
	require.NoError(t, err)
	t.Cleanup(func() { _ = appInstance.DB.Close() })

	assert.NotNil(t, appInstance.DB)
	assert.NotNil(t, appInstance.Crypto)
	assert.NotNil(t, appInstance.Session)
	assert.NotNil(t, appInstance.Terminal)
	assert.NotNil(t, appInstance.File)
	assert.NotNil(t, appInstance.Tunnel)
	assert.NotNil(t, appInstance.Key)
	assert.NotNil(t, appInstance.Macro)
	assert.NotNil(t, appInstance.Theme)
	assert.NotNil(t, appInstance.Log)
	assert.NotNil(t, appInstance.Sync)

	assert.Len(t, appInstance.Crypto, 32)
}

func TestNewEmptyDataDir(t *testing.T) {
	_, err := New(Options{DataDir: ""})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "data directory is required")
}

func TestCryptoAdapterEncrypt(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	ca := &cryptoAdapter{key: key}

	ciphertext, err := ca.Encrypt([]byte("hello"))
	require.NoError(t, err)
	assert.NotEqual(t, "hello", string(ciphertext))

	plaintext, err := ca.Decrypt(ciphertext)
	require.NoError(t, err)
	assert.Equal(t, "hello", string(plaintext))
}

func TestCryptoAdapterEncryptEmpty(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	ca := &cryptoAdapter{key: key}

	ciphertext, err := ca.Encrypt([]byte{})
	require.NoError(t, err)
	assert.NotNil(t, ciphertext)

	plaintext, err := ca.Decrypt(ciphertext)
	require.NoError(t, err)
	assert.Empty(t, plaintext)
}

func TestCryptoAdapterDecryptCorrupted(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	ca := &cryptoAdapter{key: key}

	_, err := ca.Decrypt([]byte("corrupted-data"))
	assert.Error(t, err)
}

func TestNopEventBusEmit(t *testing.T) {
	bus := &nopEventBus{}
	assert.NotPanics(t, func() {
		bus.Emit("test", "payload")
	})
}

func TestNewDataDirIsFile(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "file.txt")
	require.NoError(t, os.WriteFile(dataDir, []byte("data"), 0o600))

	_, err := New(Options{DataDir: dataDir})
	assert.Error(t, err)
}

func TestNewDataDirContainsNullByte(t *testing.T) {
	_, err := New(Options{DataDir: "/tmp/\x00invalid"})
	assert.Error(t, err)
}
