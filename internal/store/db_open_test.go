package store

import (
	"database/sql"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenDBCreatesSecureDirectoryAndFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits are not portable to Windows")
	}
	dataDir := filepath.Join(t.TempDir(), "nested", "data")

	db, err := OpenDB(dataDir)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	assertPathMode(t, dataDir, 0o700)
	assertPathMode(t, filepath.Join(dataDir, "mssh.db"), 0o600)
}

func TestOpenDBTightensExistingDirectoryAndFileModes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits are not portable to Windows")
	}
	dataDir := filepath.Join(t.TempDir(), "data")
	require.NoError(t, os.Mkdir(dataDir, 0o700))
	require.NoError(t, os.Chmod(dataDir, 0o777))
	dbPath := filepath.Join(dataDir, "mssh.db")
	require.NoError(t, os.WriteFile(dbPath, nil, 0o600))
	require.NoError(t, os.Chmod(dbPath, 0o666))

	db, err := OpenDB(dataDir)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	assertPathMode(t, dataDir, 0o700)
	assertPathMode(t, dbPath, 0o600)
}

func TestOpenDBUsesSecureFileOpenFlags(t *testing.T) {
	file := &stubDBFile{}
	dependencies := successfulDBOpenDependencies(file)
	var flags int
	var mode fs.FileMode
	dependencies.openFile = func(_ string, actualFlags int, actualMode fs.FileMode) (dbFile, error) {
		flags = actualFlags
		mode = actualMode
		return file, nil
	}

	db, err := openDBWithDependencies("data", dependencies)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	assert.Equal(t, os.O_RDWR|os.O_CREATE, flags)
	assert.Equal(t, fs.FileMode(0o600), mode)
	assert.Equal(t, fs.FileMode(0o600), file.chmodMode)
}

func TestOpenDBUsesImmediateTransactionLock(t *testing.T) {
	dependencies := successfulDBOpenDependencies(&stubDBFile{})
	var driverName string
	var dataSourceName string
	dependencies.sqlOpen = func(actualDriverName, actualDataSourceName string) (*sql.DB, error) {
		driverName = actualDriverName
		dataSourceName = actualDataSourceName
		return sql.Open("sqlite", ":memory:")
	}

	db, err := openDBWithDependencies("data", dependencies)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	assert.Equal(t, "sqlite", driverName)
	assert.Contains(t, dataSourceName, "_txlock=immediate")
}

func TestOpenDBReportsMkdirAllError(t *testing.T) {
	mkdirErr := errors.New("mkdir failed")
	dependencies := successfulDBOpenDependencies(&stubDBFile{})
	dependencies.mkdirAll = func(string, fs.FileMode) error { return mkdirErr }

	db, err := openDBWithDependencies("data", dependencies)

	assert.Nil(t, db)
	require.ErrorIs(t, err, mkdirErr)
	assert.ErrorContains(t, err, "create data directory")
}

func TestOpenDBReportsDirectoryChmodError(t *testing.T) {
	chmodErr := errors.New("directory chmod failed")
	dependencies := successfulDBOpenDependencies(&stubDBFile{})
	dependencies.chmod = func(string, fs.FileMode) error { return chmodErr }

	db, err := openDBWithDependencies("data", dependencies)

	assert.Nil(t, db)
	require.ErrorIs(t, err, chmodErr)
	assert.ErrorContains(t, err, "secure data directory")
}

func TestOpenDBReportsFileOpenError(t *testing.T) {
	openErr := errors.New("file open failed")
	dependencies := successfulDBOpenDependencies(&stubDBFile{})
	dependencies.openFile = func(string, int, fs.FileMode) (dbFile, error) {
		return nil, openErr
	}

	db, err := openDBWithDependencies("data", dependencies)

	assert.Nil(t, db)
	require.ErrorIs(t, err, openErr)
	assert.ErrorContains(t, err, "open database file")
}

func TestOpenDBJoinsFileChmodAndCloseErrors(t *testing.T) {
	chmodErr := errors.New("file chmod failed")
	closeErr := errors.New("file close failed")
	file := &stubDBFile{chmodErr: chmodErr, closeErr: closeErr}
	dependencies := successfulDBOpenDependencies(file)

	db, err := openDBWithDependencies("data", dependencies)

	assert.Nil(t, db)
	require.ErrorIs(t, err, chmodErr)
	require.ErrorIs(t, err, closeErr)
	assert.True(t, file.closed)
}

func TestOpenDBReportsPreopenedFileCloseError(t *testing.T) {
	closeErr := errors.New("file close failed")
	file := &stubDBFile{closeErr: closeErr}
	dependencies := successfulDBOpenDependencies(file)

	db, err := openDBWithDependencies("data", dependencies)

	assert.Nil(t, db)
	require.ErrorIs(t, err, closeErr)
	assert.ErrorContains(t, err, "close database file")
}

func TestOpenDBReportsSQLOpenError(t *testing.T) {
	sqlOpenErr := errors.New("sql open failed")
	dependencies := successfulDBOpenDependencies(&stubDBFile{})
	dependencies.sqlOpen = func(string, string) (*sql.DB, error) { return nil, sqlOpenErr }

	db, err := openDBWithDependencies("data", dependencies)

	assert.Nil(t, db)
	require.ErrorIs(t, err, sqlOpenErr)
	assert.ErrorContains(t, err, "open database")
}

func TestOpenDBClosesDatabaseWhenPingFails(t *testing.T) {
	pingErr := errors.New("ping failed")
	closeErr := errors.New("database close failed")
	dependencies := successfulDBOpenDependencies(&stubDBFile{})
	closed := false
	dependencies.ping = func(*sql.DB) error { return pingErr }
	dependencies.closeDB = func(db *sql.DB) error {
		closed = true
		require.NoError(t, db.Close())
		return closeErr
	}

	db, err := openDBWithDependencies("data", dependencies)

	assert.Nil(t, db)
	assert.True(t, closed)
	require.ErrorIs(t, err, pingErr)
	require.ErrorIs(t, err, closeErr)
}

func successfulDBOpenDependencies(file dbFile) dbOpenDependencies {
	return dbOpenDependencies{
		mkdirAll: func(string, fs.FileMode) error { return nil },
		chmod:    func(string, fs.FileMode) error { return nil },
		openFile: func(string, int, fs.FileMode) (dbFile, error) { return file, nil },
		sqlOpen:  sql.Open,
		ping:     func(*sql.DB) error { return nil },
		closeDB:  func(db *sql.DB) error { return db.Close() },
	}
}

func assertPathMode(t *testing.T, path string, expected fs.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, expected, info.Mode().Perm())
}

type stubDBFile struct {
	chmodMode fs.FileMode
	chmodErr  error
	closeErr  error
	closed    bool
}

func (file *stubDBFile) Chmod(mode fs.FileMode) error {
	file.chmodMode = mode
	return file.chmodErr
}

func (file *stubDBFile) Close() error {
	file.closed = true
	return file.closeErr
}
