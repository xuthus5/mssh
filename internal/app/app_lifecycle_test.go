package app

import (
	"database/sql"
	"errors"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/store"
)

func TestNewAppClosesDatabaseWhenSchemaInitializationFails(t *testing.T) {
	dependencies, state := newLifecycleDependencies(t)
	schemaErr := errors.New("schema failed")
	dependencies.initializeSchema = func(*sql.DB) error {
		state.schemaInitialized = true
		return schemaErr
	}
	dependencies.initializeServices = func(serviceInitialization) (*App, error) {
		t.Fatal("services initialized after schema failure")
		return nil, nil
	}

	appInstance, err := newAppWithDependencies(lifecycleOptions(t), dependencies)

	assert.Nil(t, appInstance)
	require.ErrorIs(t, err, schemaErr)
	assert.True(t, state.schemaInitialized)
	assert.True(t, state.closed)
	assert.Error(t, state.db.Ping())
}

func TestNewAppClosesDatabaseWhenThemeInitializationFails(t *testing.T) {
	dataDir := t.TempDir()
	db, err := store.OpenDB(dataDir)
	require.NoError(t, err)
	state := &lifecycleState{db: db}
	dependencies := defaultAppDependencies(func(string) (*sql.DB, error) { return db, nil })
	dependencies.keychain = &lifecycleKeychain{}
	dependencies.initializeSchema = func(db *sql.DB) error {
		if schemaErr := store.InitializeSchema(db); schemaErr != nil {
			return schemaErr
		}
		_, triggerErr := db.Exec(`CREATE TRIGGER fail_theme_insert BEFORE INSERT ON themes BEGIN SELECT RAISE(FAIL, 'forced theme failure'); END`)
		return triggerErr
	}
	dependencies.closeDB = func(db *sql.DB) error {
		state.closed = true
		return db.Close()
	}

	appInstance, err := newAppWithDependencies(Options{DataDir: dataDir, Logger: slog.Default()}, dependencies)

	assert.Nil(t, appInstance)
	require.ErrorContains(t, err, "initialize terminal themes")
	assert.True(t, state.closed)
	assert.Error(t, state.db.Ping())
}

func TestNewAppJoinsStartupAndCloseErrors(t *testing.T) {
	dependencies, state := newLifecycleDependencies(t)
	startupErr := errors.New("startup failed")
	closeErr := errors.New("close failed")
	dependencies.initializeSchema = func(*sql.DB) error {
		state.schemaInitialized = true
		return startupErr
	}
	dependencies.closeDB = func(db *sql.DB) error {
		state.closed = true
		require.NoError(t, db.Close())
		return closeErr
	}

	appInstance, err := newAppWithDependencies(lifecycleOptions(t), dependencies)

	assert.Nil(t, appInstance)
	require.ErrorIs(t, err, startupErr)
	require.ErrorIs(t, err, closeErr)
	assert.ErrorContains(t, err, "close database after startup failure")
	assert.True(t, state.closed)
}

func TestNewAppReleasesDatabaseCleanupAfterSuccess(t *testing.T) {
	dependencies, state := newLifecycleDependencies(t)

	appInstance, err := newAppWithDependencies(lifecycleOptions(t), dependencies)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, state.db.Close()) })

	assert.Same(t, state.db, appInstance.DB)
	assert.False(t, state.closed)
	require.NoError(t, state.db.Ping())
}

type lifecycleState struct {
	db                *sql.DB
	closed            bool
	schemaInitialized bool
}

func newLifecycleDependencies(t *testing.T) (appDependencies, *lifecycleState) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	require.NoError(t, err)
	state := &lifecycleState{db: db}
	dependencies := appDependencies{
		openDB: func(string) (*sql.DB, error) { return db, nil },
		initializeSchema: func(*sql.DB) error {
			state.schemaInitialized = true
			return nil
		},
		initializeServices: func(input serviceInitialization) (*App, error) {
			return &App{DB: input.db}, nil
		},
		closeDB: func(db *sql.DB) error {
			state.closed = true
			return db.Close()
		},
		keychain: &lifecycleKeychain{},
	}
	return dependencies, state
}

func lifecycleOptions(t *testing.T) Options {
	t.Helper()
	return Options{DataDir: t.TempDir(), Logger: slog.Default()}
}

type lifecycleKeychain struct{}

func (*lifecycleKeychain) Get(string, string) ([]byte, error) { return nil, nil }

func (*lifecycleKeychain) Set(string, string, []byte) error { return nil }

func (*lifecycleKeychain) Delete(string, string) error { return nil }

func (*lifecycleKeychain) IsAvailable() bool { return false }
