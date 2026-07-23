package service

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
)

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
