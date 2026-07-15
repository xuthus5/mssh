package app

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

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

	persistMasterKey(masterKeyPersistence{dataDir: dataDir, key: key, keychain: keychain, logger: logger})

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
	persistMasterKey(masterKeyPersistence{dataDir: dataDir, key: key, keychain: kc, logger: logger})

	keyPath := filepath.Join(dataDir, masterKeyFile)
	saved, err := os.ReadFile(keyPath)
	require.NoError(t, err)
	assert.Equal(t, key, saved)
}

func TestPersistMasterKeyHandlesUnavailableDestinations(t *testing.T) {
	missingDataDir := filepath.Join(t.TempDir(), "missing")
	kc := &stubKeychain{available: true, setErr: assert.AnError}
	persistMasterKey(masterKeyPersistence{dataDir: missingDataDir, key: make([]byte, 32), keychain: kc, logger: slog.Default()})
}

func TestInitializeServicesReportsThemeInitializationFailure(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, db.Close())
	_, err = initializeServices(serviceInitialization{
		db: db, masterKey: make([]byte, 32), keychain: &stubKeychain{},
		opts: Options{DataDir: t.TempDir()}, eventBus: event.NewWailsEventBus(slog.Default()), logger: slog.Default(),
	})
	assert.ErrorContains(t, err, "initialize terminal themes")
}

type stubKeychain struct {
	available bool
	data      []byte
	err       error
	setErr    error
}

func (s *stubKeychain) Get(_, _ string) ([]byte, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.data, nil
}

func (s *stubKeychain) Set(_, _ string, _ []byte) error {
	return s.setErr
}

func (s *stubKeychain) Delete(_, _ string) error {
	return nil
}

func (s *stubKeychain) IsAvailable() bool {
	return s.available
}
