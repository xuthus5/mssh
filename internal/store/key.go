package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func CreateKey(db *sql.DB, k model.SSHKey) (*model.SSHKey, error) {
	result, err := db.Exec(
		"INSERT INTO ssh_keys (name, type, private_key, public_key, has_passphrase) VALUES (?, ?, ?, ?, ?)",
		k.Name, k.Type, k.PrivateKey, k.PublicKey, k.HasPassphrase,
	)
	if err != nil {
		return nil, fmt.Errorf("create key: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create key: last insert id: %w", err)
	}
	k.ID = id
	k.CreatedAt = time.Now()
	return &k, nil
}

//nolint:dupl // CRUD pattern
func ListKeys(db *sql.DB) ([]model.SSHKey, error) {
	rows, err := db.Query("SELECT id, name, type, public_key, has_passphrase, created_at FROM ssh_keys ORDER BY created_at DESC")
	if err != nil {
		return nil, fmt.Errorf("list keys: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var keys []model.SSHKey
	for rows.Next() {
		var k model.SSHKey
		var createdAt string
		err := rows.Scan(&k.ID, &k.Name, &k.Type, &k.PublicKey, &k.HasPassphrase, &createdAt)
		if err != nil {
			return nil, fmt.Errorf("scan key: %w", err)
		}
		k.CreatedAt, err = time.Parse("2006-01-02 15:04:05", createdAt)
		if err != nil {
			return nil, fmt.Errorf("scan key: parse created_at: %w", err)
		}
		keys = append(keys, k)
	}
	if keys == nil {
		keys = []model.SSHKey{}
	}
	return keys, rows.Err()
}

func DeleteKey(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM ssh_keys WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete key: %w", err)
	}
	return nil
}

func UpdateKey(db *sql.DB, key model.SSHKey) error {
	result, err := db.Exec(
		"UPDATE ssh_keys SET name = ?, type = ?, private_key = ?, public_key = ?, has_passphrase = ? WHERE id = ?",
		key.Name, key.Type, key.PrivateKey, key.PublicKey, key.HasPassphrase, key.ID,
	)
	if err != nil {
		return fmt.Errorf("update key: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update key: rows affected: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("update key: key %d not found", key.ID)
	}
	return nil
}

func GetKey(db *sql.DB, id int64) (*model.SSHKey, error) {
	var k model.SSHKey
	var createdAt string
	err := db.QueryRow(
		"SELECT id, name, type, private_key, public_key, has_passphrase, created_at FROM ssh_keys WHERE id = ?", id,
	).Scan(&k.ID, &k.Name, &k.Type, &k.PrivateKey, &k.PublicKey, &k.HasPassphrase, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("get key: %w", err)
	}
	k.CreatedAt, err = time.Parse("2006-01-02 15:04:05", createdAt)
	if err != nil {
		return nil, fmt.Errorf("get key: parse created_at: %w", err)
	}
	return &k, nil
}
