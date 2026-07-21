package store

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type dbFile interface {
	Chmod(mode fs.FileMode) error
	Close() error
}

type dbOpenDependencies struct {
	mkdirAll func(string, fs.FileMode) error
	chmod    func(string, fs.FileMode) error
	openFile func(string, int, fs.FileMode) (dbFile, error)
	sqlOpen  func(string, string) (*sql.DB, error)
	ping     func(*sql.DB) error
	closeDB  func(*sql.DB) error
}

func OpenDB(dataDir string) (*sql.DB, error) {
	return openDBWithDependencies(dataDir, defaultDBOpenDependencies())
}

func defaultDBOpenDependencies() dbOpenDependencies {
	return dbOpenDependencies{
		mkdirAll: os.MkdirAll,
		chmod:    os.Chmod,
		openFile: func(path string, flag int, mode fs.FileMode) (dbFile, error) {
			return os.OpenFile(path, flag, mode)
		},
		sqlOpen: sql.Open,
		ping:    func(db *sql.DB) error { return db.Ping() },
		closeDB: func(db *sql.DB) error { return db.Close() },
	}
}

func openDBWithDependencies(dataDir string, dependencies dbOpenDependencies) (*sql.DB, error) {
	if err := dependencies.mkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	if err := dependencies.chmod(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("secure data directory: %w", err)
	}
	dbPath := filepath.Join(dataDir, "mssh.db")
	file, err := dependencies.openFile(dbPath, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open database file: %w", err)
	}
	if err = file.Chmod(0o600); err != nil {
		return nil, errors.Join(fmt.Errorf("secure database file: %w", err), closeDBFile(file))
	}
	if err = file.Close(); err != nil {
		return nil, fmt.Errorf("close database file: %w", err)
	}
	dsn := dbPath + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate"
	db, err := dependencies.sqlOpen("sqlite", dsn)
	if err != nil {
		return nil, errors.Join(fmt.Errorf("open database: %w", err), closeOpenedDB(db, dependencies.closeDB))
	}
	db.SetMaxOpenConns(1)
	if err = dependencies.ping(db); err != nil {
		return nil, errors.Join(fmt.Errorf("ping database: %w", err), closeOpenedDB(db, dependencies.closeDB))
	}
	return db, nil
}

func closeDBFile(file dbFile) error {
	if err := file.Close(); err != nil {
		return fmt.Errorf("close database file: %w", err)
	}
	return nil
}

func closeOpenedDB(db *sql.DB, closeDB func(*sql.DB) error) error {
	if db == nil {
		return nil
	}
	if err := closeDB(db); err != nil {
		return fmt.Errorf("close database: %w", err)
	}
	return nil
}

func InitializeSchema(db *sql.DB) error {
	return initializeSchema(db, databaseFormatVersion, setDatabaseVersion)
}

func initializeSchema(db *sql.DB, targetVersion int, setVersion func(*sql.Tx, int) error) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("initialize schema: begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	currentVersion, err := databaseVersion(tx)
	if err != nil {
		return fmt.Errorf("initialize schema: read format version: %w", err)
	}
	if currentVersion > targetVersion {
		return fmt.Errorf("initialize schema: database format %d is newer than supported %d; upgrade the application", currentVersion, targetVersion)
	}
	// Existing databases with an older format must not be silently wiped.
	if currentVersion != 0 && currentVersion < targetVersion {
		return fmt.Errorf("initialize schema: database format %d requires unsupported migration to %d; restore a matching backup or export data before recreating the database", currentVersion, targetVersion)
	}
	// Fresh install only (version 0). Refuse half-migrated/legacy tables without a format version.
	if currentVersion == 0 {
		exists, checkErr := hasApplicationTables(tx)
		if checkErr != nil {
			return fmt.Errorf("initialize schema: inspect tables: %w", checkErr)
		}
		if exists {
			return fmt.Errorf("initialize schema: legacy database without supported format version detected; export data and recreate the database")
		}
	}
	if err = createFinalSchema(tx); err != nil {
		return err
	}
	if err = initializeDefaultFolder(tx); err != nil {
		return err
	}
	if currentVersion != targetVersion {
		if err = setVersion(tx, targetVersion); err != nil {
			return fmt.Errorf("initialize schema: set format version: %w", err)
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("initialize schema: commit transaction: %w", err)
	}
	return nil
}

func databaseVersion(tx *sql.Tx) (int, error) {
	var version int
	if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return 0, err
	}
	return version, nil
}

func hasApplicationTables(tx *sql.Tx) (bool, error) {
	var count int
	err := tx.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'`).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func createFinalSchema(tx *sql.Tx) error {
	for _, statement := range finalSchemaStatements {
		if _, err := tx.Exec(statement.sql); err != nil {
			return fmt.Errorf("initialize schema: create %s schema: %w", statement.name, err)
		}
	}
	return nil
}

func setDatabaseVersion(tx *sql.Tx, version int) error {
	_, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", version))
	return err
}

func initializeDefaultFolder(tx *sql.Tx) error {
	var defaultID int64
	err := tx.QueryRow("SELECT id FROM session_folders ORDER BY is_default DESC, id LIMIT 1").Scan(&defaultID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("initialize schema: find default folder: %w", err)
	}
	if errors.Is(err, sql.ErrNoRows) {
		result, insertErr := tx.Exec("INSERT INTO session_folders (name, is_default) VALUES ('默认分组', 1)")
		if insertErr != nil {
			return fmt.Errorf("initialize schema: create default folder: %w", insertErr)
		}
		defaultID, insertErr = result.LastInsertId()
		if insertErr != nil {
			return fmt.Errorf("initialize schema: read default folder id: %w", insertErr)
		}
	}
	if _, err = tx.Exec("UPDATE session_folders SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END", defaultID); err != nil {
		return fmt.Errorf("initialize schema: select default folder: %w", err)
	}
	if _, err = tx.Exec("UPDATE sessions SET folder_id = ? WHERE folder_id IS NULL", defaultID); err != nil {
		return fmt.Errorf("initialize schema: assign default folder: %w", err)
	}
	return nil
}
