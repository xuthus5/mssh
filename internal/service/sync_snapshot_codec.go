package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
)

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
	temporary, err := os.CreateTemp(filepath.Dir(path), ".mssh-backup-*.tmp")
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
		var cid, notNull, primaryKey int
		var name, columnType string
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
