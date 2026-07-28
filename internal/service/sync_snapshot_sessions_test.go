package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestValidateSnapshotAcceptsValidSessionRowsBeforeAndAfterJSON(t *testing.T) {
	db := testutil.NewTestDB(t)
	data, err := newTestSyncService(db, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	data.Tables["sessions"] = []map[string]any{snapshotSessionRow(testStoredSessionPassword(t, "secret"))}
	require.NoError(t, validateSnapshot(db, data))

	content, err := json.Marshal(data)
	require.NoError(t, err)
	var decoded ExportData
	require.NoError(t, decodeSnapshot(content, &decoded))
	require.NoError(t, validateSnapshot(db, decoded))
}

func TestValidateSnapshotRejectsInvalidSessionRows(t *testing.T) {
	db := testutil.NewTestDB(t)
	base, err := newTestSyncService(db, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	validPassword := testStoredSessionPassword(t, "secret")

	tests := []struct {
		name string
		rows []map[string]any
	}{
		{name: "plaintext password", rows: []map[string]any{snapshotSessionRow("plain-secret")}},
		{name: "oversized name", rows: []map[string]any{snapshotSessionRowWith(validPassword, "name", strings.Repeat("n", sessionNameLimit+1))}},
		{name: "invalid host utf8", rows: []map[string]any{snapshotSessionRowWith(validPassword, "host", string([]byte{0xff}))}},
		{name: "notes contain nul", rows: []map[string]any{snapshotSessionRowWith(validPassword, "notes", "note\x00tail")}},
		{name: "invalid notes utf8", rows: []map[string]any{snapshotSessionRowWith(validPassword, "notes", string([]byte{0xff}))}},
		{name: "invalid port", rows: []map[string]any{snapshotSessionRowWith(validPassword, "port", int64(0))}},
		{name: "key auth without key", rows: []map[string]any{snapshotSessionRowWith(validPassword, "auth_method", "key")}},
		{name: "invalid folder id", rows: []map[string]any{snapshotSessionRowWith(validPassword, "folder_id", int64(-1))}},
		{name: "invalid key id", rows: []map[string]any{snapshotSessionRowWith(validPassword, "key_id", int64(-1))}},
		{name: "negative keep alive", rows: []map[string]any{snapshotSessionRowWith(validPassword, "keep_alive", int64(-1))}},
		{name: "oversized sort order", rows: []map[string]any{snapshotSessionRowWith(validPassword, "sort_order", int64(maxAssetSortOrder+1))}},
		{name: "negative connection count", rows: []map[string]any{snapshotSessionRowWith(validPassword, "connection_count", int64(-1))}},
		{name: "invalid last connected", rows: []map[string]any{snapshotSessionRowWith(validPassword, "last_connected_at", "invalid")}},
		{name: "missing updated at", rows: []map[string]any{snapshotSessionRowWithout(validPassword, "updated_at")}},
		{name: "non string password", rows: []map[string]any{snapshotSessionRowWith(validPassword, "password", int64(1))}},
		{
			name: "duplicate id",
			rows: []map[string]any{snapshotSessionRow(validPassword), snapshotSessionRow(validPassword)},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			data := base
			data.Tables = cloneSnapshotTables(base.Tables)
			data.Tables["sessions"] = test.rows
			require.Error(t, validateSnapshot(db, data))
		})
	}
}

func TestSnapshotSessionFromRowRejectsEveryMissingField(t *testing.T) {
	password := testStoredSessionPassword(t, "secret")
	fields := []string{
		"id", "folder_id", "name", "host", "port", "username", "notes", "environment_id", "project_id", "key_id",
		"auth_method", "password", "keep_alive", "term_type", "sort_order", "last_connected_at", "connection_count",
		"created_at", "updated_at",
	}
	for _, field := range fields {
		t.Run(field, func(t *testing.T) {
			_, err := snapshotSessionFromRow(snapshotSessionRowWithout(password, field))
			require.ErrorContains(t, err, field)
		})
	}
}

func TestSnapshotSessionFromRowAcceptsNullableAndReferencedValues(t *testing.T) {
	row := snapshotSessionRow("")
	row["folder_id"] = int64(2)
	row["environment_id"] = int64(3)
	row["project_id"] = int64(4)
	row["key_id"] = int64(5)
	row["password"] = nil
	row["last_connected_at"] = "2026-07-28 12:01:02"

	session, err := snapshotSessionFromRow(row)
	require.NoError(t, err)
	require.Equal(t, int64(2), *session.FolderID)
	require.Equal(t, int64(3), *session.EnvironmentID)
	require.Equal(t, int64(4), *session.ProjectID)
	require.Equal(t, int64(5), *session.KeyID)
	require.NotNil(t, session.LastConnectedAt)
}

func TestSnapshotSessionFromRowRejectsInvalidFieldTypesAndTimes(t *testing.T) {
	password := testStoredSessionPassword(t, "secret")
	tests := []struct {
		name  string
		field string
		value any
	}{
		{name: "integer type", field: "port", value: "22"},
		{name: "nullable integer type", field: "folder_id", value: "1"},
		{name: "nullable time type", field: "last_connected_at", value: int64(1)},
		{name: "same length invalid time", field: "created_at", value: "2026-13-28 12:00:00"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := snapshotSessionFromRow(snapshotSessionRowWith(password, test.field, test.value))
			require.Error(t, err)
		})
	}
}

func snapshotSessionRow(password string) map[string]any {
	return map[string]any{
		"id": int64(1), "folder_id": nil, "name": "server", "host": "127.0.0.1", "port": int64(22),
		"username": "root", "notes": "", "environment_id": nil, "project_id": nil, "auth_method": "password",
		"password": password, "key_id": nil, "keep_alive": int64(30), "term_type": "xterm-256color", "sort_order": int64(0),
		"last_connected_at": nil, "connection_count": int64(0), "created_at": "2026-07-28 12:00:00", "updated_at": "2026-07-28 12:00:00",
	}
}

func snapshotSessionRowWith(password, field string, value any) map[string]any {
	row := snapshotSessionRow(password)
	row[field] = value
	return row
}

func snapshotSessionRowWithout(password, field string) map[string]any {
	row := snapshotSessionRow(password)
	delete(row, field)
	return row
}
