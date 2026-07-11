package app

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/crypto"
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
	assert.NotNil(t, appInstance.Setting)

	assert.Len(t, appInstance.Crypto, 32)
	assert.NotNil(t, appInstance.Keychain)
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

func TestMasterKeyPersistence(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	err := os.MkdirAll(dataDir, 0o700)
	require.NoError(t, err)

	app1, err := New(Options{DataDir: dataDir})
	require.NoError(t, err)
	t.Cleanup(func() { _ = app1.DB.Close() })
	key1 := string(app1.Crypto)

	app2, err := New(Options{DataDir: dataDir})
	require.NoError(t, err)
	t.Cleanup(func() { _ = app2.DB.Close() })

	assert.Equal(t, key1, string(app2.Crypto), "master key should persist between sessions")
}

func TestApp_Shutdown(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	err := os.MkdirAll(dataDir, 0o700)
	require.NoError(t, err)

	appInstance, err := New(Options{DataDir: dataDir})
	require.NoError(t, err)

	appInstance.Shutdown()

	pingErr := appInstance.DB.Ping()
	assert.Error(t, pingErr, "db should be closed after shutdown")
}

func TestLoadMasterKeyFromFile(t *testing.T) {
	dataDir := t.TempDir()
	keychain := crypto.NewKeychainAdapter()
	logger := slog.Default()

	// No key file exists → returns nil
	key, err := loadMasterKey(dataDir, keychain, logger)
	require.NoError(t, err)
	assert.Nil(t, key)

	// Create a valid key file
	validKey := make([]byte, 32)
	for i := range validKey {
		validKey[i] = byte(i)
	}
	keyPath := filepath.Join(dataDir, masterKeyFile)
	require.NoError(t, os.WriteFile(keyPath, validKey, 0o600))

	key, err = loadMasterKey(dataDir, keychain, logger)
	require.NoError(t, err)
	assert.Equal(t, validKey, key)

	// Invalid key length → returns nil
	require.NoError(t, os.WriteFile(keyPath, []byte("short"), 0o600))
	key, err = loadMasterKey(dataDir, keychain, logger)
	require.NoError(t, err)
	assert.Nil(t, key)
}

func TestPersistMasterKey(t *testing.T) {
	dataDir := t.TempDir()
	keychain := crypto.NewKeychainAdapter()
	logger := slog.Default()

	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}

	persistMasterKey(dataDir, key, keychain, logger)

	keyPath := filepath.Join(dataDir, masterKeyFile)
	saved, err := os.ReadFile(keyPath)
	require.NoError(t, err)
	assert.Equal(t, key, saved)
}

func TestDefaultTestLogger(t *testing.T) {
	logger := DefaultTestLogger(t)
	assert.NotNil(t, logger)
	logger.Info("test log message")
}

func TestShutdownNilDB(t *testing.T) {
	a := &App{}
	a.Shutdown()
}

func TestNewWithLogger(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	appInstance, err := New(Options{DataDir: dataDir, Logger: slog.Default()})
	require.NoError(t, err)
	t.Cleanup(func() { _ = appInstance.DB.Close() })
	assert.NotNil(t, appInstance.Session)
}

func TestLoadMasterKeyKeychainReturnsKey(t *testing.T) {
	dataDir := t.TempDir()
	kc := &stubKeychain{available: true, data: make([]byte, 32)}
	logger := slog.Default()

	key, err := loadMasterKey(dataDir, kc, logger)
	require.NoError(t, err)
	require.NotNil(t, key)
	assert.Len(t, key, 32)
}

func TestLoadMasterKeyKeychainErrorFallback(t *testing.T) {
	dataDir := t.TempDir()
	kc := &stubKeychain{available: true, err: assert.AnError}
	logger := slog.Default()

	// Keychain errors and no file → returns nil
	key, err := loadMasterKey(dataDir, kc, logger)
	require.NoError(t, err)
	assert.Nil(t, key)
}

func TestPersistMasterKeyKeychainAvailable(t *testing.T) {
	dataDir := t.TempDir()
	kc := &stubKeychain{available: true}
	logger := slog.Default()

	key := make([]byte, 32)
	persistMasterKey(dataDir, key, kc, logger)

	keyPath := filepath.Join(dataDir, masterKeyFile)
	saved, err := os.ReadFile(keyPath)
	require.NoError(t, err)
	assert.Equal(t, key, saved)
}

type stubKeychain struct {
	available bool
	data      []byte
	err       error
}

func (s *stubKeychain) Get(_, _ string) ([]byte, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.data, nil
}

func (s *stubKeychain) Set(_, _ string, _ []byte) error {
	return nil
}

func (s *stubKeychain) Delete(_, _ string) error {
	return nil
}

func (s *stubKeychain) IsAvailable() bool {
	return s.available
}
