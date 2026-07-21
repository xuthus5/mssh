package service

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SecurityService) reencryptProtectedData(oldDEK, newDEK []byte) error {
	oldCrypto := &staticCrypto{key: oldDEK}
	newCrypto := &staticCrypto{key: newDEK}
	if err := s.reencryptSSHKeys(oldCrypto, newCrypto); err != nil {
		return err
	}
	return s.reencryptSessionPasswords(oldCrypto, newCrypto)
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
