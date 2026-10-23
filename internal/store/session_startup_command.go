package store

import (
	"database/sql"
	"fmt"
)

var sessionStartupCommandColumns = []schemaStatement{
	{name: "startup_command", sql: "ALTER TABLE sessions ADD COLUMN startup_command TEXT NOT NULL DEFAULT ''"},
}

func initializeSessionStartupCommandSchema(tx *sql.Tx) error {
	columns, err := sessionColumnNames(tx)
	if err != nil {
		return err
	}
	for _, column := range sessionStartupCommandColumns {
		if _, exists := columns[column.name]; exists {
			continue
		}
		if _, err := tx.Exec(column.sql); err != nil {
			return fmt.Errorf("add %s: %w", column.name, err)
		}
	}
	return nil
}
