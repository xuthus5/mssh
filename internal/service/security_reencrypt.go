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
	keyIDs, err := listSSHKeyIDs(s.db)
	if err != nil {
		return fmt.Errorf("list keys: %w", err)
	}
	for _, keyID := range keyIDs {
		key, getErr := store.GetKey(s.db, keyID)
		if getErr != nil {
			return fmt.Errorf("load key %d: %w", keyID, getErr)
		}
		plain, decErr := oldCrypto.Decrypt([]byte(key.PrivateKey))
		if decErr != nil {
			return fmt.Errorf("decrypt key %d: %w", keyID, decErr)
		}
		sealed, encErr := newCrypto.Encrypt(plain)
		if encErr != nil {
			return fmt.Errorf("encrypt key %d: %w", keyID, encErr)
		}
		key.PrivateKey = string(sealed)
		if err := store.UpdateKey(s.db, *key); err != nil {
			return fmt.Errorf("update key %d: %w", keyID, err)
		}
	}
	sessions, err := store.ListSessions(s.db, nil)
	if err != nil {
		return fmt.Errorf("list sessions: %w", err)
	}
	for _, session := range sessions {
		if session.Password == "" {
			continue
		}
		plain := session.Password
		if strings.HasPrefix(session.Password, sessionPasswordPrefix) {
			opened, openErr := openSessionPassword(oldCrypto, session.Password)
			if openErr != nil {
				return fmt.Errorf("decrypt session %d password: %w", session.ID, openErr)
			}
			plain = opened
		}
		sealed, sealErr := sealSessionPassword(newCrypto, plain)
		if sealErr != nil {
			return fmt.Errorf("encrypt session %d password: %w", session.ID, sealErr)
		}
		session.Password = sealed
		if err := store.UpdateSession(s.db, session); err != nil {
			return fmt.Errorf("update session %d: %w", session.ID, err)
		}
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
