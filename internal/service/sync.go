package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const syncFormatVersion = 1

type SyncService struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewSyncService(db *sql.DB, logger *slog.Logger) *SyncService {
	return &SyncService{db: db, logger: logger}
}

type ExportData struct {
	FormatVersion int             `json:"format_version"`
	Sessions      []model.Session `json:"sessions"`
	Keys          []model.SSHKey  `json:"keys"`
	Macros        []model.Macro   `json:"macros"`
}

type syncImportDocument struct {
	FormatVersion json.RawMessage `json:"format_version"`
	Sessions      []model.Session `json:"sessions"`
	Keys          []model.SSHKey  `json:"keys"`
	Macros        []model.Macro   `json:"macros"`
}

func (s *SyncService) Export(path string) error {
	s.logger.Info("exporting data", "path", path)
	sessions, err := store.ListSessions(s.db, nil)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}
	keys, err := store.ListKeys(s.db)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}
	macros, err := store.ListMacros(s.db)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}

	// Strip sensitive fields from sessions before export.
	safeSessions := make([]model.Session, len(sessions))
	for i, sess := range sessions {
		sess.Password = ""
		safeSessions[i] = sess
	}

	data := ExportData{
		FormatVersion: syncFormatVersion,
		Sessions:      safeSessions,
		Keys:          keys,
		Macros:        macros,
	}

	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}
	defer func() { _ = file.Close() }()

	if err := json.NewEncoder(file).Encode(data); err != nil {
		return fmt.Errorf("export: %w", err)
	}
	return nil
}

func (s *SyncService) Import(path string) error {
	s.logger.Info("importing data", "path", path)
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	defer func() { _ = file.Close() }()

	data, err := decodeSyncData(file)
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}

	for _, sess := range data.Sessions {
		copySess := sess
		copySess.ID = 0
		if _, err := store.CreateSession(s.db, copySess); err != nil {
			return fmt.Errorf("import: %w", err)
		}
	}
	for _, key := range data.Keys {
		copyKey := key
		copyKey.ID = 0
		if _, err := store.CreateKey(s.db, copyKey); err != nil {
			return fmt.Errorf("import: %w", err)
		}
	}
	for _, macro := range data.Macros {
		copyMacro := macro
		copyMacro.ID = 0
		if _, err := store.CreateMacro(s.db, copyMacro); err != nil {
			return fmt.Errorf("import: %w", err)
		}
	}

	return nil
}

func decodeSyncData(reader io.Reader) (ExportData, error) {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	var document syncImportDocument
	if err := decoder.Decode(&document); err != nil {
		return ExportData{}, fmt.Errorf("decode sync document: %w", err)
	}
	formatVersion, err := decodeSyncFormatVersion(document.FormatVersion)
	if err != nil {
		return ExportData{}, fmt.Errorf("decode sync document: %w", err)
	}

	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return ExportData{}, fmt.Errorf("decode sync document trailer: trailing JSON value")
		}
		return ExportData{}, fmt.Errorf("decode sync document trailer: %w", err)
	}
	data := ExportData{
		FormatVersion: formatVersion,
		Sessions:      document.Sessions,
		Keys:          document.Keys,
		Macros:        document.Macros,
	}

	if data.FormatVersion != syncFormatVersion {
		return ExportData{}, fmt.Errorf("validate sync document: format_version must be %d, got %d", syncFormatVersion, data.FormatVersion)
	}
	if data.Sessions == nil {
		return ExportData{}, fmt.Errorf("validate sync document: sessions array is required")
	}
	if data.Keys == nil {
		return ExportData{}, fmt.Errorf("validate sync document: keys array is required")
	}
	if data.Macros == nil {
		return ExportData{}, fmt.Errorf("validate sync document: macros array is required")
	}

	return data, nil
}

func decodeSyncFormatVersion(raw json.RawMessage) (int, error) {
	if len(raw) == 0 {
		return 0, nil
	}
	if string(raw) == "null" {
		return 0, errors.New("format_version must be an integer")
	}

	var version int
	if err := json.Unmarshal(raw, &version); err != nil {
		return 0, errors.New("format_version must be an integer")
	}
	return version, nil
}

func (s *SyncService) SyncToCloud() error {
	return fmt.Errorf("cloud sync not implemented")
}

func (s *SyncService) SyncFromCloud() error {
	return fmt.Errorf("cloud sync not implemented")
}
