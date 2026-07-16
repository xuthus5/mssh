package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sort"
	"strings"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
)

const (
	SyncMasterKeySetting = "sync.master_key"
	syncFormatVersion    = 2
)

var backupTables = []string{"session_folders", "ssh_keys", "sessions", "tunnels", "macros", "settings", "themes", "terminal_theme_profiles"}

var backupDeleteOrder = []string{"terminal_theme_profiles", "themes", "tunnels", "sessions", "ssh_keys", "session_folders", "macros", "settings"}

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
	plaintext, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("export: encode data: %w", err)
	}
	envelope, err := backupcrypto.EncryptBackup(plaintext, []byte(masterKey))
	if err != nil {
		return fmt.Errorf("export: encrypt: %w", err)
	}
	content, err := backupcrypto.EncodeBackup(envelope)
	if err != nil {
		return fmt.Errorf("export: encode envelope: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}
	defer func() { _ = file.Close() }()
	if _, err := file.Write(content); err != nil {
		return fmt.Errorf("export: write: %w", err)
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
	if err := s.restore(data); err != nil {
		return fmt.Errorf("import: %w", err)
	}
	s.logger.Info("imported encrypted configuration", "path", path)
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
	for _, table := range []string{"session_folders", "ssh_keys", "sessions", "tunnels", "macros", "settings", "themes", "terminal_theme_profiles"} {
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
