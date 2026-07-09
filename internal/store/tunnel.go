package store

import (
	"database/sql"
	"fmt"
	"time"

	"mssh/internal/model"
)

func CreateTunnel(db *sql.DB, t model.Tunnel) (*model.Tunnel, error) {
	result, err := db.Exec(
		"INSERT INTO tunnels (session_id, name, type, local_host, local_port, remote_host, remote_port) VALUES (?, ?, ?, ?, ?, ?, ?)",
		t.SessionID, t.Name, t.Type, t.LocalHost, t.LocalPort, t.RemoteHost, t.RemotePort,
	)
	if err != nil {
		return nil, fmt.Errorf("create tunnel: %w", err)
	}
	id, _ := result.LastInsertId()
	t.ID = id
	t.CreatedAt = time.Now()
	return &t, nil
}

func ListTunnels(db *sql.DB) ([]model.Tunnel, error) {
	rows, err := db.Query("SELECT id, session_id, name, type, local_host, local_port, remote_host, remote_port, created_at FROM tunnels ORDER BY created_at DESC")
	if err != nil {
		return nil, fmt.Errorf("list tunnels: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var tunnels []model.Tunnel
	for rows.Next() {
		var t model.Tunnel
		var createdAt string
		err := rows.Scan(&t.ID, &t.SessionID, &t.Name, &t.Type, &t.LocalHost, &t.LocalPort, &t.RemoteHost, &t.RemotePort, &createdAt)
		if err != nil {
			return nil, fmt.Errorf("scan tunnel: %w", err)
		}
		t.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt)
		tunnels = append(tunnels, t)
	}
	if tunnels == nil {
		tunnels = []model.Tunnel{}
	}
	return tunnels, rows.Err()
}

func UpdateTunnel(db *sql.DB, t model.Tunnel) error {
	_, err := db.Exec(
		"UPDATE tunnels SET session_id=?, name=?, type=?, local_host=?, local_port=?, remote_host=?, remote_port=? WHERE id=?",
		t.SessionID, t.Name, t.Type, t.LocalHost, t.LocalPort, t.RemoteHost, t.RemotePort, t.ID,
	)
	if err != nil {
		return fmt.Errorf("update tunnel: %w", err)
	}
	return nil
}

func DeleteTunnel(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM tunnels WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete tunnel: %w", err)
	}
	return nil
}
