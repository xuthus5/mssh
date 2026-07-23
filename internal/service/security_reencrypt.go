package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SecurityService) reencryptProtectedData(oldDEK, newDEK []byte) error {
	oldCrypto := &staticCrypto{key: oldDEK}
	newCrypto := &staticCrypto{key: newDEK}
	if err := s.reencryptSSHKeys(oldCrypto, newCrypto); err != nil {
		return err
	}
	if err := s.reencryptSessionPasswords(oldCrypto, newCrypto); err != nil {
		return err
	}
	if err := reencryptProxyPasswordSetting(s.db, oldCrypto, newCrypto); err != nil {
		return err
	}
	return reencryptSyncCredentialSettings(s.db, oldCrypto, newCrypto)
}

func (s *SecurityService) reencryptSSHKeys(oldCrypto, newCrypto KeyCrypto) error {
	keyIDs, err := listSSHKeyIDs(s.db)
	if err != nil {
		return fmt.Errorf("list keys: %w", err)
	}
	for _, keyID := range keyIDs {
		if err := reencryptSSHKey(s.db, keyID, oldCrypto, newCrypto); err != nil {
			return err
		}
	}
	return nil
}

func reencryptSSHKey(db *sql.DB, keyID int64, oldCrypto, newCrypto KeyCrypto) error {
	key, err := store.GetKey(db, keyID)
	if err != nil {
		return fmt.Errorf("load key %d: %w", keyID, err)
	}
	plain, err := oldCrypto.Decrypt([]byte(key.PrivateKey))
	if err != nil {
		return fmt.Errorf("decrypt key %d: %w", keyID, err)
	}
	sealed, err := newCrypto.Encrypt(plain)
	if err != nil {
		return fmt.Errorf("encrypt key %d: %w", keyID, err)
	}
	key.PrivateKey = string(sealed)
	if err := store.UpdateKey(db, *key); err != nil {
		return fmt.Errorf("update key %d: %w", keyID, err)
	}
	return nil
}

func (s *SecurityService) reencryptSessionPasswords(oldCrypto, newCrypto KeyCrypto) error {
	sessions, err := store.ListSessions(s.db, nil)
	if err != nil {
		return fmt.Errorf("list sessions: %w", err)
	}
	for _, session := range sessions {
		if session.Password == "" {
			continue
		}
		sealed, err := reencryptSessionPassword(oldCrypto, newCrypto, session.Password)
		if err != nil {
			return fmt.Errorf("session %d password: %w", session.ID, err)
		}
		session.Password = sealed
		if err := store.UpdateSession(s.db, session); err != nil {
			return fmt.Errorf("update session %d: %w", session.ID, err)
		}
	}
	return nil
}

func reencryptSessionPassword(oldCrypto, newCrypto KeyCrypto, stored string) (string, error) {
	plain := stored
	if strings.HasPrefix(stored, sessionPasswordPrefix) {
		opened, err := openSessionPassword(oldCrypto, stored)
		if err != nil {
			return "", fmt.Errorf("decrypt: %w", err)
		}
		plain = opened
	}
	sealed, err := sealSessionPassword(newCrypto, plain)
	if err != nil {
		return "", fmt.Errorf("encrypt: %w", err)
	}
	return sealed, nil
}

func reencryptProxyPasswordSetting(db *sql.DB, oldCrypto, newCrypto KeyCrypto) error {
	entry, err := store.GetSettingEntry(db, applicationProxyPasswordSetting)
	if err != nil {
		return fmt.Errorf("load proxy password: %w", err)
	}
	if entry == nil || strings.TrimSpace(entry.Value) == "" {
		return nil
	}
	var raw string
	if err := json.Unmarshal([]byte(entry.Value), &raw); err != nil {
		return fmt.Errorf("decode proxy password: %w", err)
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	plain, err := decryptProxyPasswordValue(oldCrypto, raw)
	if err != nil {
		return fmt.Errorf("decrypt proxy password: %w", err)
	}
	if plain == "" {
		return nil
	}
	sealed, err := encryptProxyPasswordValue(newCrypto, plain)
	if err != nil {
		return fmt.Errorf("encrypt proxy password: %w", err)
	}
	payload, err := json.Marshal(sealed)
	if err != nil {
		return err
	}
	entry.Value = string(payload)
	entry.ValueType = "string"
	if entry.Namespace == "" {
		entry.Namespace = "application"
	}
	if entry.Version == 0 {
		entry.Version = 1
	}
	if err := store.SetSettings(db, []model.Setting{*entry}); err != nil {
		return fmt.Errorf("store proxy password: %w", err)
	}
	return nil
}

func decryptProxyPasswordValue(crypto KeyCrypto, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	// Legacy plaintext passwords remain usable until the next save/rotate.
	if !strings.HasPrefix(raw, proxyPasswordEncPrefix) {
		return raw, nil
	}
	if crypto == nil {
		return "", fmt.Errorf("proxy password decryption is unavailable")
	}
	plaintext, err := crypto.Decrypt([]byte(strings.TrimPrefix(raw, proxyPasswordEncPrefix)))
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func encryptProxyPasswordValue(crypto KeyCrypto, plaintext string) (string, error) {
	if crypto == nil {
		return "", fmt.Errorf("proxy password encryption is unavailable")
	}
	encrypted, err := crypto.Encrypt([]byte(plaintext))
	if err != nil {
		return "", err
	}
	return proxyPasswordEncPrefix + string(encrypted), nil
}

func reencryptSyncCredentialSettings(db *sql.DB, oldCrypto, newCrypto KeyCrypto) error {
	for _, key := range []string{syncGistTokenSetting, syncWebDAVPasswordSetting, syncS3SecretSetting} {
		if err := reencryptSyncCredentialSetting(db, key, oldCrypto, newCrypto); err != nil {
			return err
		}
	}
	return nil
}

func reencryptSyncCredentialSetting(db *sql.DB, key string, oldCrypto, newCrypto KeyCrypto) error {
	var encrypted string
	if err := readSyncSetting(db, key, &encrypted); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("load %s: %w", key, err)
	}
	encrypted = strings.TrimSpace(encrypted)
	if encrypted == "" {
		return nil
	}
	plain, err := oldCrypto.Decrypt([]byte(encrypted))
	if err != nil {
		return fmt.Errorf("decrypt %s: %w", key, err)
	}
	sealed, err := newCrypto.Encrypt(plain)
	if err != nil {
		return fmt.Errorf("encrypt %s: %w", key, err)
	}
	if err := writeSyncSetting(db, key, string(sealed)); err != nil {
		return fmt.Errorf("store %s: %w", key, err)
	}
	return nil
}

type staticCrypto struct{ key []byte }

func (s *staticCrypto) Encrypt(plaintext []byte) ([]byte, error) {
	return crypto.Encrypt(plaintext, s.key)
}

func (s *staticCrypto) Decrypt(ciphertext []byte) ([]byte, error) {
	return crypto.Decrypt(ciphertext, s.key)
}

func listSSHKeyIDs(db *sql.DB) ([]int64, error) {
	rows, err := db.Query("SELECT id FROM ssh_keys ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
