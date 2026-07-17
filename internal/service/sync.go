package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
)

const (
	SyncMasterKeySetting = "sync.master_key"
	syncFormatVersion    = 2
	syncRecoveryFileName = "pre-import.msshbackup"
)

var backupTables = []string{"session_folders", "ssh_keys", "sessions", "tunnels", "macros", "settings", "themes", "terminal_theme_profiles", "transfer_jobs"}

var backupDeleteOrder = []string{"transfer_jobs", "terminal_theme_profiles", "themes", "tunnels", "sessions", "ssh_keys", "session_folders", "macros", "settings"}

type SyncService struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewSyncService(db *sql.DB, logger *slog.Logger) *SyncService {
	return &SyncService{db: db, logger: logger}
}

type ExportData struct {
	FormatVersion int                         `json:"format_version"`
	Tables        map[string][]map[string]any `json:"tables"`
}

func (s *SyncService) Export(path string) error {
	masterKey, err := s.masterKey()
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}
	data, err := s.snapshot()
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}
	content, err := encodeEncryptedSnapshot(data, masterKey)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}
	if err := writePrivateFileAtomic(path, content); err != nil {
		return fmt.Errorf("export: %w", err)
	}
	s.logger.Info("exported encrypted configuration", "path", path)
	return nil
}

func (s *SyncService) Import(path string) error {
	masterKey, err := s.masterKey()
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	var envelope backupcrypto.BackupEnvelope
	if err := json.Unmarshal(content, &envelope); err != nil {
		return fmt.Errorf("import: decode envelope: %w", err)
	}
	plaintext, err := backupcrypto.DecryptBackup(envelope, []byte(masterKey))
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	var data ExportData
	if err := decodeSnapshot(plaintext, &data); err != nil {
		return fmt.Errorf("import: %w", err)
	}
	if err := validateSnapshot(s.db, data); err != nil {
		return fmt.Errorf("import: validate: %w", err)
	}
	if err := s.writeRecoveryPoint(masterKey); err != nil {
		return fmt.Errorf("import: recovery point: %w", err)
	}
	if err := s.restore(data); err != nil {
		return fmt.Errorf("import: %w", err)
	}
	s.logger.Info("imported encrypted configuration", "path", path)
	return nil
}

func encodeEncryptedSnapshot(data ExportData, masterKey string) ([]byte, error) {
	plaintext, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("encode data: %w", err)
	}
	envelope, err := backupcrypto.EncryptBackup(plaintext, []byte(masterKey))
	if err != nil {
		return nil, fmt.Errorf("encrypt: %w", err)
	}
	content, err := backupcrypto.EncodeBackup(envelope)
	if err != nil {
		return nil, fmt.Errorf("encode envelope: %w", err)
	}
	return content, nil
}

func writePrivateFileAtomic(path string, content []byte) error {
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".mssh-backup-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() { _ = os.Remove(temporaryPath) }()
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func (s *SyncService) writeRecoveryPoint(masterKey string) error {
	data, err := s.snapshot()
	if err != nil {
		return err
	}
	content, err := encodeEncryptedSnapshot(data, masterKey)
	if err != nil {
		return err
	}
	path, err := s.recoveryPath()
	if err != nil {
		return err
	}
	if err := writePrivateFileAtomic(path, content); err != nil {
		return err
	}
	s.logger.Info("created pre-import recovery point", "path", path)
	return nil
}

func (s *SyncService) recoveryPath() (string, error) {
	var sequence int
	var name, databasePath string
	if err := s.db.QueryRow("PRAGMA database_list").Scan(&sequence, &name, &databasePath); err != nil {
		return "", err
	}
	if databasePath == "" {
		return "", errors.New("database path is unavailable")
	}
	return filepath.Join(filepath.Dir(databasePath), syncRecoveryFileName), nil
}

func validateSnapshot(db *sql.DB, data ExportData) error {
	for _, table := range backupTables {
		columns, err := tableColumns(db, table)
		if err != nil {
			return err
		}
		if err := validateTableRows(table, data.Tables[table], columns); err != nil {
			return err
		}
	}
	return nil
}

func tableColumns(db *sql.DB, table string) (map[string]struct{}, error) {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, fmt.Errorf("inspect %s: %w", table, err)
	}
	defer func() { _ = rows.Close() }()
	columns := make(map[string]struct{})
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return nil, fmt.Errorf("inspect %s: %w", table, err)
		}
		columns[name] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inspect %s: %w", table, err)
	}
	return columns, nil
}

func validateTableRows(table string, rows []map[string]any, columns map[string]struct{}) error {
	for index, record := range rows {
		for column := range record {
			if _, ok := columns[column]; !ok {
				return fmt.Errorf("table %s row %d contains unknown column %s", table, index, column)
			}
		}
	}
	return nil
}

func (s *SyncService) masterKey() (string, error) {
	var raw string
	err := s.db.QueryRow("SELECT value FROM settings WHERE key = ?", SyncMasterKeySetting).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errors.New("master key is not configured")
	}
	if err != nil {
		return "", fmt.Errorf("read master key: %w", err)
	}
	var key string
	if err := json.Unmarshal([]byte(raw), &key); err != nil || len(key) < 12 {
		return "", errors.New("master key is invalid")
	}
	return key, nil
}

func (s *SyncService) snapshot() (ExportData, error) {
	tables := make(map[string][]map[string]any, len(backupTables))
	for _, table := range backupTables {
		rows, err := readTable(s.db, table)
		if err != nil {
			return ExportData{}, fmt.Errorf("read %s: %w", table, err)
		}
		if table == "settings" {
			filtered := rows[:0]
			for _, row := range rows {
				if row["key"] != SyncMasterKeySetting {
					filtered = append(filtered, row)
				}
			}
			rows = filtered
		}
		tables[table] = rows
	}
	return ExportData{FormatVersion: syncFormatVersion, Tables: tables}, nil
}

func decodeSnapshot(content []byte, data *ExportData) error {
	decoder := json.NewDecoder(strings.NewReader(string(content)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(data); err != nil {
		return fmt.Errorf("decode snapshot: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("decode snapshot: trailing JSON value")
	}
	if data.FormatVersion != syncFormatVersion {
		return fmt.Errorf("snapshot format_version must be %d, got %d", syncFormatVersion, data.FormatVersion)
	}
	for _, table := range backupTables {
		if _, ok := data.Tables[table]; !ok {
			return fmt.Errorf("snapshot table %s is required", table)
		}
	}
	return nil
}

func (s *SyncService) restore(data ExportData) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin restore: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, table := range backupDeleteOrder {
		statement := "DELETE FROM " + table
		arguments := []any(nil)
		if table == "settings" {
			statement = "DELETE FROM settings WHERE key <> ?"
			arguments = []any{SyncMasterKeySetting}
		}
		if _, err := tx.Exec(statement, arguments...); err != nil {
			return fmt.Errorf("clear %s: %w", table, err)
		}
	}
	for _, table := range []string{"session_folders", "ssh_keys", "sessions", "tunnels", "macros", "settings", "themes", "terminal_theme_profiles", "transfer_jobs"} {
		for _, row := range data.Tables[table] {
			if err := insertRow(tx, table, row); err != nil {
				return fmt.Errorf("restore %s: %w", table, err)
			}
		}
	}
	return tx.Commit()
}

func readTable(db *sql.DB, table string) ([]map[string]any, error) {
	rows, err := db.Query("SELECT * FROM " + table)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(columns))
		for i, value := range values {
			if bytes, ok := value.([]byte); ok {
				row[columns[i]] = string(bytes)
			} else {
				row[columns[i]] = value
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func insertRow(tx *sql.Tx, table string, row map[string]any) error {
	columns := make([]string, 0, len(row))
	for column := range row {
		columns = append(columns, column)
	}
	sort.Strings(columns)
	values := make([]any, len(columns))
	for index, column := range columns {
		values[index] = row[column]
	}
	placeholders := make([]string, len(columns))
	for i := range placeholders {
		placeholders[i] = "?"
	}
	_, err := tx.Exec("INSERT INTO "+table+" ("+strings.Join(columns, ",")+") VALUES ("+strings.Join(placeholders, ",")+")", values...)
	return err
}

func (s *SyncService) SyncToCloud() error { return fmt.Errorf("cloud sync not implemented") }

func (s *SyncService) SyncFromCloud() error { return fmt.Errorf("cloud sync not implemented") }
