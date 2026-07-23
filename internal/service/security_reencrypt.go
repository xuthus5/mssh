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

type reencryptPlan struct {
	keys     []reencryptKeyUpdate
	sessions []reencryptSessionUpdate
	settings []model.Setting
}

type reencryptKeyUpdate struct {
	id         int64
	privateKey string
}

type reencryptSessionUpdate struct {
	id       int64
	password string
}

func (s *SecurityService) reencryptProtectedData(oldDEK, newDEK []byte) error {
	oldCrypto := &staticCrypto{key: oldDEK}
	newCrypto := &staticCrypto{key: newDEK}
	plan, err := buildReencryptPlan(s.db, oldCrypto, newCrypto)
	if err != nil {
		return err
	}
	return applyReencryptPlan(s.db, plan)
}

func buildReencryptPlan(db *sql.DB, oldCrypto, newCrypto KeyCrypto) (reencryptPlan, error) {
	keys, err := planSSHKeyUpdates(db, oldCrypto, newCrypto)
	if err != nil {
		return reencryptPlan{}, err
	}
	sessions, err := planSessionPasswordUpdates(db, oldCrypto, newCrypto)
	if err != nil {
		return reencryptPlan{}, err
	}
	settings, err := planSettingSecretUpdates(db, oldCrypto, newCrypto)
	if err != nil {
		return reencryptPlan{}, err
	}
	return reencryptPlan{keys: keys, sessions: sessions, settings: settings}, nil
}

func planSSHKeyUpdates(db *sql.DB, oldCrypto, newCrypto KeyCrypto) ([]reencryptKeyUpdate, error) {
	keyIDs, err := listSSHKeyIDs(db)
	if err != nil {
		return nil, fmt.Errorf("list keys: %w", err)
	}
	updates := make([]reencryptKeyUpdate, 0, len(keyIDs))
	for _, keyID := range keyIDs {
		key, err := store.GetKey(db, keyID)
		if err != nil {
			return nil, fmt.Errorf("load key %d: %w", keyID, err)
		}
		plain, err := oldCrypto.Decrypt([]byte(key.PrivateKey))
		if err != nil {
			return nil, fmt.Errorf("decrypt key %d: %w", keyID, err)
		}
		sealed, err := newCrypto.Encrypt(plain)
		if err != nil {
			return nil, fmt.Errorf("encrypt key %d: %w", keyID, err)
		}
		updates = append(updates, reencryptKeyUpdate{id: keyID, privateKey: string(sealed)})
	}
	return updates, nil
}

func planSessionPasswordUpdates(db *sql.DB, oldCrypto, newCrypto KeyCrypto) ([]reencryptSessionUpdate, error) {
	sessions, err := store.ListSessions(db, nil)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	updates := make([]reencryptSessionUpdate, 0)
	for _, session := range sessions {
		if session.Password == "" {
			continue
		}
		sealed, err := reencryptSessionPassword(oldCrypto, newCrypto, session.Password)
		if err != nil {
			return nil, fmt.Errorf("session %d password: %w", session.ID, err)
		}
		updates = append(updates, reencryptSessionUpdate{id: session.ID, password: sealed})
	}
	return updates, nil
}

func planSettingSecretUpdates(db *sql.DB, oldCrypto, newCrypto KeyCrypto) ([]model.Setting, error) {
	var settings []model.Setting
	proxy, err := planProxyPasswordSetting(db, oldCrypto, newCrypto)
	if err != nil {
		return nil, err
	}
	if proxy != nil {
		settings = append(settings, *proxy)
	}
	for _, key := range []string{syncGistTokenSetting, syncWebDAVPasswordSetting, syncS3SecretSetting} {
		setting, err := planSyncCredentialSetting(db, key, oldCrypto, newCrypto)
		if err != nil {
			return nil, err
		}
		if setting != nil {
			settings = append(settings, *setting)
		}
	}
	return settings, nil
}

func planProxyPasswordSetting(db *sql.DB, oldCrypto, newCrypto KeyCrypto) (*model.Setting, error) {
	entry, err := store.GetSettingEntry(db, applicationProxyPasswordSetting)
	if err != nil {
		return nil, fmt.Errorf("load proxy password: %w", err)
	}
	if entry == nil || strings.TrimSpace(entry.Value) == "" {
		return nil, nil
	}
	var raw string
	if err := json.Unmarshal([]byte(entry.Value), &raw); err != nil {
		return nil, fmt.Errorf("decode proxy password: %w", err)
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	plain, err := decryptProxyPasswordValue(oldCrypto, raw)
	if err != nil {
		return nil, fmt.Errorf("decrypt proxy password: %w", err)
	}
	if plain == "" {
		return nil, nil
	}
	sealed, err := encryptProxyPasswordValue(newCrypto, plain)
	if err != nil {
		return nil, fmt.Errorf("encrypt proxy password: %w", err)
	}
	payload, err := json.Marshal(sealed)
	if err != nil {
		return nil, err
	}
	entry.Value = string(payload)
	entry.ValueType = "string"
	if entry.Namespace == "" {
		entry.Namespace = "application"
	}
	if entry.Version == 0 {
		entry.Version = 1
	}
	return entry, nil
}

func planSyncCredentialSetting(db *sql.DB, key string, oldCrypto, newCrypto KeyCrypto) (*model.Setting, error) {
	var encrypted string
	if err := readSyncSetting(db, key, &encrypted); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load %s: %w", key, err)
	}
	encrypted = strings.TrimSpace(encrypted)
	if encrypted == "" {
		return nil, nil
	}
	plain, err := oldCrypto.Decrypt([]byte(encrypted))
	if err != nil {
		return nil, fmt.Errorf("decrypt %s: %w", key, err)
	}
	sealed, err := newCrypto.Encrypt(plain)
	if err != nil {
		return nil, fmt.Errorf("encrypt %s: %w", key, err)
	}
	payload, err := json.Marshal(string(sealed))
	if err != nil {
		return nil, err
	}
	return &model.Setting{
		Key: key, Namespace: "sync", Value: string(payload), ValueType: "string", Version: 1,
	}, nil
}

func applyReencryptPlan(db *sql.DB, plan reencryptPlan) error {
	if len(plan.keys) == 0 && len(plan.sessions) == 0 && len(plan.settings) == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin reencrypt transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, update := range plan.keys {
		if err := applyKeyPrivateKeyUpdate(tx, update); err != nil {
			return err
		}
	}
	for _, update := range plan.sessions {
		if err := applySessionPasswordUpdate(tx, update); err != nil {
			return err
		}
	}
	for _, setting := range plan.settings {
		if err := applySettingUpdate(tx, setting); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit reencrypt transaction: %w", err)
	}
	return nil
}

func applyKeyPrivateKeyUpdate(tx *sql.Tx, update reencryptKeyUpdate) error {
	result, err := tx.Exec("UPDATE ssh_keys SET private_key = ? WHERE id = ?", update.privateKey, update.id)
	if err != nil {
		return fmt.Errorf("update key %d: %w", update.id, err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update key %d rows: %w", update.id, err)
	}
	if rows == 0 {
		return fmt.Errorf("update key %d: not found", update.id)
	}
	return nil
}

func applySessionPasswordUpdate(tx *sql.Tx, update reencryptSessionUpdate) error {
	result, err := tx.Exec("UPDATE sessions SET password = ?, updated_at=datetime('now') WHERE id = ?", update.password, update.id)
	if err != nil {
		return fmt.Errorf("update session %d password: %w", update.id, err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update session %d rows: %w", update.id, err)
	}
	if rows == 0 {
		return fmt.Errorf("update session %d: not found", update.id)
	}
	return nil
}

func applySettingUpdate(tx *sql.Tx, setting model.Setting) error {
	_, err := tx.Exec(
		`INSERT INTO settings (key, namespace, value, value_type, version, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(key) DO UPDATE SET namespace=excluded.namespace, value=excluded.value, value_type=excluded.value_type, version=excluded.version, updated_at=datetime('now')`,
		setting.Key, setting.Namespace, setting.Value, setting.ValueType, setting.Version,
	)
	if err != nil {
		return fmt.Errorf("update setting %s: %w", setting.Key, err)
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
