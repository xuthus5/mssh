package store

import (
	"database/sql"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

const defaultSSHJumpPort = 22

var sessionJumpHostColumns = []schemaStatement{
	{name: "jump_host", sql: "ALTER TABLE sessions ADD COLUMN jump_host TEXT NOT NULL DEFAULT ''"},
	{name: "jump_port", sql: "ALTER TABLE sessions ADD COLUMN jump_port INTEGER NOT NULL DEFAULT 22"},
	{name: "jump_username", sql: "ALTER TABLE sessions ADD COLUMN jump_username TEXT NOT NULL DEFAULT ''"},
	{name: "jump_auth_method", sql: "ALTER TABLE sessions ADD COLUMN jump_auth_method TEXT NOT NULL DEFAULT 'password' CHECK(jump_auth_method IN ('password','key','agent','keyboard-interactive'))"},
	{name: "jump_password", sql: "ALTER TABLE sessions ADD COLUMN jump_password TEXT NOT NULL DEFAULT ''"},
	{name: "jump_key_id", sql: "ALTER TABLE sessions ADD COLUMN jump_key_id INTEGER REFERENCES ssh_keys(id)"},
}

func initializeSessionJumpHostSchema(tx *sql.Tx) error {
	columns, err := sessionColumnNames(tx)
	if err != nil {
		return err
	}
	for _, column := range sessionJumpHostColumns {
		if _, exists := columns[column.name]; exists {
			continue
		}
		if _, err := tx.Exec(column.sql); err != nil {
			return fmt.Errorf("add %s: %w", column.name, err)
		}
	}
	return nil
}

func sessionColumnNames(tx *sql.Tx) (map[string]struct{}, error) {
	rows, err := tx.Query("SELECT name FROM pragma_table_info('sessions')")
	if err != nil {
		return nil, fmt.Errorf("inspect session columns: %w", err)
	}
	defer func() { _ = rows.Close() }()
	columns := make(map[string]struct{})
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scan session column: %w", err)
		}
		columns[name] = struct{}{}
	}
	return columns, rows.Err()
}

func storedSessionJumpHost(jump *model.SSHJumpHost) model.SSHJumpHost {
	if jump == nil {
		return model.SSHJumpHost{Port: defaultSSHJumpPort, AuthMethod: model.AuthPassword}
	}
	return *jump
}
