package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

const serialPortsTableSQL = `CREATE TABLE IF NOT EXISTS serial_ports (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	device TEXT NOT NULL,
	baud_rate INTEGER NOT NULL DEFAULT 115200,
	data_bits INTEGER NOT NULL DEFAULT 8,
	parity TEXT NOT NULL DEFAULT 'none' CHECK(parity IN ('none','odd','even','mark','space')),
	stop_bits TEXT NOT NULL DEFAULT '1' CHECK(stop_bits IN ('1','1.5','2')),
	flow_control TEXT NOT NULL DEFAULT 'none',
	line_ending TEXT NOT NULL DEFAULT 'cr',
	local_echo INTEGER NOT NULL DEFAULT 0,
	dtr_on_open INTEGER NOT NULL DEFAULT 1,
	rts_on_open INTEGER NOT NULL DEFAULT 1,
	notes TEXT NOT NULL DEFAULT '',
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const serialPortSelectCols = `id, name, device, baud_rate, data_bits, parity, stop_bits, flow_control,
	line_ending, local_echo, dtr_on_open, rts_on_open, notes, sort_order, created_at, updated_at`

func ListSerialPorts(db *sql.DB) ([]model.SerialPort, error) {
	rows, err := db.Query(`SELECT ` + serialPortSelectCols + ` FROM serial_ports ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list serial ports: %w", err)
	}
	defer func() { _ = rows.Close() }()
	ports := make([]model.SerialPort, 0)
	for rows.Next() {
		port, err := scanSerialPort(rows)
		if err != nil {
			return nil, err
		}
		ports = append(ports, port)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list serial ports iterate: %w", err)
	}
	return ports, nil
}

func GetSerialPort(db *sql.DB, id int64) (*model.SerialPort, error) {
	port, err := scanSerialPort(db.QueryRow(`SELECT `+serialPortSelectCols+` FROM serial_ports WHERE id = ?`, id))
	if err != nil {
		return nil, err
	}
	return &port, nil
}

func CreateSerialPort(db *sql.DB, port model.SerialPort) (*model.SerialPort, error) {
	result, err := db.Exec(`INSERT INTO serial_ports (
		name, device, baud_rate, data_bits, parity, stop_bits, flow_control,
		line_ending, local_echo, dtr_on_open, rts_on_open, notes, sort_order
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		port.Name, port.Device, port.BaudRate, port.DataBits, port.Parity, port.StopBits, port.FlowControl,
		port.LineEnding, boolToInt(port.LocalEcho), boolToInt(port.DTROnOpen), boolToInt(port.RTSOnOpen),
		port.Notes, port.SortOrder,
	)
	if err != nil {
		return nil, fmt.Errorf("create serial port: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create serial port id: %w", err)
	}
	return GetSerialPort(db, id)
}

func UpdateSerialPort(db *sql.DB, port model.SerialPort) error {
	result, err := db.Exec(`UPDATE serial_ports SET
		name=?, device=?, baud_rate=?, data_bits=?, parity=?, stop_bits=?, flow_control=?,
		line_ending=?, local_echo=?, dtr_on_open=?, rts_on_open=?, notes=?, sort_order=?,
		updated_at=datetime('now')
		WHERE id=?`,
		port.Name, port.Device, port.BaudRate, port.DataBits, port.Parity, port.StopBits, port.FlowControl,
		port.LineEnding, boolToInt(port.LocalEcho), boolToInt(port.DTROnOpen), boolToInt(port.RTSOnOpen),
		port.Notes, port.SortOrder, port.ID,
	)
	if err != nil {
		return fmt.Errorf("update serial port: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update serial port rows: %w", err)
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func DeleteSerialPort(db *sql.DB, id int64) error {
	result, err := db.Exec(`DELETE FROM serial_ports WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete serial port: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete serial port rows: %w", err)
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// DeleteSerialPorts removes multiple profiles in one statement.
func DeleteSerialPorts(db *sql.DB, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	query := `DELETE FROM serial_ports WHERE id IN (`
	args := make([]any, 0, len(ids))
	for i, id := range ids {
		if i > 0 {
			query += ","
		}
		query += "?"
		args = append(args, id)
	}
	query += ")"
	result, err := db.Exec(query, args...)
	if err != nil {
		return 0, fmt.Errorf("delete serial ports: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("delete serial ports rows: %w", err)
	}
	return affected, nil
}

type serialScanner interface {
	Scan(dest ...any) error
}

func scanSerialPort(row serialScanner) (model.SerialPort, error) {
	var port model.SerialPort
	var createdAt, updatedAt string
	var localEcho, dtrOnOpen, rtsOnOpen int
	err := row.Scan(
		&port.ID, &port.Name, &port.Device, &port.BaudRate, &port.DataBits,
		&port.Parity, &port.StopBits, &port.FlowControl, &port.LineEnding,
		&localEcho, &dtrOnOpen, &rtsOnOpen, &port.Notes, &port.SortOrder,
		&createdAt, &updatedAt,
	)
	if err != nil {
		return model.SerialPort{}, err
	}
	port.LocalEcho = localEcho != 0
	port.DTROnOpen = dtrOnOpen != 0
	port.RTSOnOpen = rtsOnOpen != 0
	port.CreatedAt, err = time.Parse("2006-01-02 15:04:05", createdAt)
	if err != nil {
		return model.SerialPort{}, fmt.Errorf("scan serial port: parse created_at: %w", err)
	}
	port.UpdatedAt, err = time.Parse("2006-01-02 15:04:05", updatedAt)
	if err != nil {
		return model.SerialPort{}, fmt.Errorf("scan serial port: parse updated_at: %w", err)
	}
	return port, nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
