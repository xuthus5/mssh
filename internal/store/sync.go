package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func InsertSyncVersion(db *sql.DB, version model.SyncVersion) (model.SyncVersion, error) {
	result, err := db.Exec(`INSERT INTO sync_versions (version_id, version_number, parent_version_id, snapshot_fingerprint, provider, source, file_name, size_bytes, protected, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		version.VersionID, version.VersionNumber, version.ParentVersionID, version.SnapshotFingerprint, version.Provider,
		version.Source, version.FileName, version.SizeBytes, version.Protected, version.CreatedAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return model.SyncVersion{}, fmt.Errorf("insert sync version: %w", err)
	}
	version.ID, err = result.LastInsertId()
	if err != nil {
		return model.SyncVersion{}, fmt.Errorf("read sync version id: %w", err)
	}
	return version, nil
}

func FindSyncVersionByFingerprint(db *sql.DB, fingerprint string) (*model.SyncVersion, error) {
	version, err := scanSyncVersion(db.QueryRow(syncVersionSelect+` WHERE snapshot_fingerprint = ? ORDER BY id DESC LIMIT 1`, fingerprint))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find sync version: %w", err)
	}
	return &version, nil
}

func GetSyncVersion(db *sql.DB, id int64) (*model.SyncVersion, error) {
	version, err := scanSyncVersion(db.QueryRow(syncVersionSelect+` WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get sync version: %w", err)
	}
	return &version, nil
}

func ListSyncVersions(db *sql.DB, limit int) ([]model.SyncVersion, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := db.Query(syncVersionSelect+` ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list sync versions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	versions := make([]model.SyncVersion, 0)
	for rows.Next() {
		version, scanErr := scanSyncVersion(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("list sync versions: %w", scanErr)
		}
		versions = append(versions, version)
	}
	return versions, rows.Err()
}

func DeleteSyncVersion(db *sql.DB, id int64) error {
	if _, err := db.Exec("DELETE FROM sync_versions WHERE id = ? AND protected = 0", id); err != nil {
		return fmt.Errorf("delete sync version: %w", err)
	}
	return nil
}

func SetSyncVersionProtected(db *sql.DB, id int64, protected bool) error {
	if _, err := db.Exec("UPDATE sync_versions SET protected = ? WHERE id = ?", protected, id); err != nil {
		return fmt.Errorf("protect sync version: %w", err)
	}
	return nil
}

func InsertSyncEvent(db *sql.DB, event model.SyncEvent) (model.SyncEvent, error) {
	result, err := db.Exec(`INSERT INTO sync_events (action, provider, strategy, status, local_version, remote_version, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		event.Action, event.Provider, event.Strategy, event.Status, event.LocalVersion, event.RemoteVersion, event.Message,
		event.CreatedAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return model.SyncEvent{}, fmt.Errorf("insert sync event: %w", err)
	}
	event.ID, err = result.LastInsertId()
	if err != nil {
		return model.SyncEvent{}, fmt.Errorf("read sync event id: %w", err)
	}
	return event, nil
}

func ListSyncEvents(db *sql.DB, limit int) ([]model.SyncEvent, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := db.Query(`SELECT id, action, provider, strategy, status, local_version, remote_version, message, created_at FROM sync_events ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list sync events: %w", err)
	}
	defer func() { _ = rows.Close() }()
	events := make([]model.SyncEvent, 0)
	for rows.Next() {
		event, scanErr := scanSyncEvent(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("list sync events: %w", scanErr)
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

const syncVersionSelect = `SELECT id, version_id, version_number, parent_version_id, snapshot_fingerprint, provider, source, file_name, size_bytes, protected, created_at FROM sync_versions`

type syncScanner interface {
	Scan(dest ...any) error
}

func scanSyncVersion(scanner syncScanner) (model.SyncVersion, error) {
	var version model.SyncVersion
	var createdAt string
	err := scanner.Scan(&version.ID, &version.VersionID, &version.VersionNumber, &version.ParentVersionID,
		&version.SnapshotFingerprint, &version.Provider, &version.Source, &version.FileName, &version.SizeBytes,
		&version.Protected, &createdAt)
	if err != nil {
		return model.SyncVersion{}, err
	}
	version.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	return version, err
}

func scanSyncEvent(scanner syncScanner) (model.SyncEvent, error) {
	var event model.SyncEvent
	var createdAt string
	err := scanner.Scan(&event.ID, &event.Action, &event.Provider, &event.Strategy, &event.Status,
		&event.LocalVersion, &event.RemoteVersion, &event.Message, &createdAt)
	if err != nil {
		return model.SyncEvent{}, err
	}
	event.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	return event, err
}
