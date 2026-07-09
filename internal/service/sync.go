package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"

	"mssh/internal/model"
	"mssh/internal/store"
)

type SyncService struct {
	db *sql.DB
}

func NewSyncService(db *sql.DB) *SyncService {
	return &SyncService{db: db}
}

type ExportData struct {
	Sessions []model.Session `json:"sessions"`
	Keys     []model.SSHKey  `json:"keys"`
	Macros   []model.Macro   `json:"macros"`
}

func (s *SyncService) Export(path string) error {
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

	data := ExportData{
		Sessions: sessions,
		Keys:     keys,
		Macros:   macros,
	}

	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}
	defer file.Close()

	if err := json.NewEncoder(file).Encode(data); err != nil {
		return fmt.Errorf("export: %w", err)
	}
	return nil
}

func (s *SyncService) Import(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	defer file.Close()

	var data ExportData
	if err := json.NewDecoder(file).Decode(&data); err != nil {
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

func (s *SyncService) SyncToCloud() error {
	return nil
}

func (s *SyncService) SyncFromCloud() error {
	return nil
}
