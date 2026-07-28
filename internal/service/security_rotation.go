package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	securityRotationPendingSetting = "security.rotation_pending"
	securityRotationMarkerVersion  = 1
)

type securityRotationMarker struct {
	Version  int              `json:"version"`
	OldVault crypto.VaultFile `json:"old_vault"`
	NewVault crypto.VaultFile `json:"new_vault"`
}

func isLocalOnlySetting(key string) bool {
	return key == securityRotationPendingSetting
}

func (s *SecurityService) writePendingRotation(marker securityRotationMarker) error {
	payload, err := json.Marshal(marker)
	if err != nil {
		return fmt.Errorf("encode pending password rotation: %w", err)
	}
	return store.SetSettings(s.db, []model.Setting{{
		Key: securityRotationPendingSetting, Namespace: "security", Value: string(payload), ValueType: "object", Version: 1,
	}})
}

func (s *SecurityService) clearPendingRotation() error {
	if err := store.DeleteSetting(s.db, securityRotationPendingSetting); err != nil {
		return fmt.Errorf("clear pending password rotation: %w", err)
	}
	return nil
}

func clearPendingRotationTx(tx *sql.Tx) error {
	if _, err := tx.Exec("DELETE FROM settings WHERE key = ?", securityRotationPendingSetting); err != nil {
		return fmt.Errorf("clear pending password rotation: %w", err)
	}
	return nil
}

func (s *SecurityService) rollbackPendingRotation(marker securityRotationMarker) error {
	if err := s.saveVault(marker.OldVault); err != nil {
		return fmt.Errorf("restore previous vault: %w", err)
	}
	return s.clearPendingRotation()
}

func (s *SecurityService) saveVault(vault crypto.VaultFile) error {
	saver := s.saveVaultFile
	if saver == nil {
		saver = crypto.SaveVaultFile
	}
	return saver(crypto.VaultPath(s.dataDir), vault)
}

// RecoverPendingRotation restores the old vault after an interrupted rotation.
//
//wails:ignore
func (s *SecurityService) RecoverPendingRotation() error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	return s.recoverPendingRotation()
}

func (s *SecurityService) recoverPendingRotation() error {
	entry, err := store.GetSettingEntry(s.db, securityRotationPendingSetting)
	if err != nil {
		return fmt.Errorf("read pending password rotation: %w", err)
	}
	if entry == nil {
		return nil
	}
	marker, err := decodeRotationMarker(entry.Value)
	if err != nil {
		return err
	}
	current, err := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
	if errors.Is(err, os.ErrNotExist) {
		return s.rollbackPendingRotation(marker)
	}
	if err != nil {
		return fmt.Errorf("load vault during password rotation recovery: %w", err)
	}
	if current == marker.OldVault {
		return s.clearPendingRotation()
	}
	if current != marker.NewVault {
		return errors.New("pending password rotation has an unknown vault state; restore a backup before starting the application")
	}
	return s.rollbackPendingRotation(marker)
}

func decodeRotationMarker(raw string) (securityRotationMarker, error) {
	var marker securityRotationMarker
	if err := json.Unmarshal([]byte(raw), &marker); err != nil {
		return securityRotationMarker{}, fmt.Errorf("decode pending password rotation: %w", err)
	}
	if marker.Version != securityRotationMarkerVersion {
		return securityRotationMarker{}, fmt.Errorf("unsupported password rotation marker version %d", marker.Version)
	}
	if marker.OldVault.FormatVersion == 0 || marker.NewVault.FormatVersion == 0 {
		return securityRotationMarker{}, errors.New("pending password rotation marker is incomplete")
	}
	return marker, nil
}
