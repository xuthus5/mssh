package service

import "fmt"

// syncInsertColumns is intentionally independent of database introspection.
// Snapshot data is untrusted, so both table and column identifiers must come
// from this fixed allow-list before they are interpolated into SQL.
var syncInsertColumns = map[string]map[string]struct{}{
	"session_folders":         columnSet("id", "name", "parent_id", "is_default", "sort_order", "created_at", "updated_at"),
	"ssh_keys":                columnSet("id", "name", "type", "private_key", "public_key", "has_passphrase", "created_at"),
	"asset_environments":      columnSet("id", "name", "name_key", "color_token", "sort_order", "created_at", "updated_at"),
	"asset_projects":          columnSet("id", "name", "name_key", "code", "code_key", "description", "sort_order", "created_at", "updated_at"),
	"asset_tags":              columnSet("id", "name", "name_key", "color_token", "created_at", "updated_at"),
	"sessions":                columnSet("id", "folder_id", "name", "host", "port", "username", "notes", "environment_id", "project_id", "auth_method", "password", "key_id", "keep_alive", "term_type", "sort_order", "last_connected_at", "connection_count", "created_at", "updated_at"),
	"session_tags":            columnSet("session_id", "tag_id", "created_at"),
	"tunnels":                 columnSet("id", "session_id", "name", "type", "local_host", "local_port", "remote_host", "remote_port", "created_at"),
	"macros":                  columnSet("id", "name", "command", "shortcut", "delay_ms", "sort_order", "created_at"),
	"serial_ports":            columnSet("id", "name", "device", "baud_rate", "data_bits", "parity", "stop_bits", "flow_control", "line_ending", "local_echo", "dtr_on_open", "rts_on_open", "notes", "sort_order", "created_at", "updated_at"),
	"settings":                columnSet("key", "namespace", "value", "value_type", "version", "updated_at"),
	"themes":                  columnSet("id", "name", "mode", "source_type", "source_name", "source_url", "source_author", "source_license", "source_version", "source_fingerprint", "color_payload", "raw_payload", "is_builtin", "created_at", "updated_at"),
	"terminal_theme_profiles": columnSet("id", "name", "theme_id", "follow_global_style", "font_family", "font_size", "cursor_style", "color_overrides", "created_at", "updated_at"),
	"transfer_jobs":           columnSet("id", "session_id", "session_name", "direction", "source_path", "target_path", "total_bytes", "transferred_bytes", "speed", "eta", "status", "error", "started_at", "completed_at"),
}

func columnSet(columns ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(columns))
	for _, column := range columns {
		result[column] = struct{}{}
	}
	return result
}

func validateSyncInsertRow(table string, row map[string]any) ([]string, error) {
	allowed, ok := syncInsertColumns[table]
	if !ok {
		return nil, fmt.Errorf("unsupported snapshot table %q", table)
	}
	if len(row) == 0 {
		return nil, fmt.Errorf("snapshot row for table %s is empty", table)
	}
	columns := make([]string, 0, len(row))
	for column := range row {
		if _, ok := allowed[column]; !ok {
			return nil, fmt.Errorf("table %s contains unsupported column %q", table, column)
		}
		columns = append(columns, column)
	}
	return columns, nil
}
