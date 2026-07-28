package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestValidateSnapshotAcceptsValidFolderTreeBeforeAndAfterJSON(t *testing.T) {
	database := testutil.NewTestDB(t)
	data, err := newTestSyncService(database, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	data.Tables["session_folders"] = validSnapshotFolderRows()
	require.NoError(t, validateSnapshot(database, data))

	content, err := json.Marshal(data)
	require.NoError(t, err)
	var decoded ExportData
	require.NoError(t, decodeSnapshot(content, &decoded))
	require.NoError(t, validateSnapshot(database, decoded))
}

func TestValidateSnapshotRejectsInvalidFolderRows(t *testing.T) {
	tests := []struct {
		name  string
		field string
		value any
	}{
		{name: "invalid id", field: "id", value: int64(0)},
		{name: "oversized name", field: "name", value: strings.Repeat("f", sessionFolderNameLimit+1)},
		{name: "noncanonical name", field: "name", value: " child "},
		{name: "invalid name utf8", field: "name", value: string([]byte{0xff})},
		{name: "invalid parent id", field: "parent_id", value: int64(0)},
		{name: "invalid default flag", field: "is_default", value: int64(2)},
		{name: "negative sort order", field: "sort_order", value: int64(-1)},
		{name: "oversized sort order", field: "sort_order", value: int64(maxAssetSortOrder + 1)},
		{name: "invalid created at", field: "created_at", value: "invalid"},
		{name: "wrong updated at type", field: "updated_at", value: int64(1)},
	}
	assertSnapshotFolderCasesRejected(t, tests)
}

func TestValidateSnapshotRejectsInvalidFolderGraph(t *testing.T) {
	tests := []struct {
		name string
		rows []map[string]any
	}{
		{name: "empty tree", rows: []map[string]any{}},
		{name: "no default", rows: []map[string]any{snapshotFolderRow(1, nil, false, "root")}},
		{name: "multiple defaults", rows: []map[string]any{snapshotFolderRow(1, nil, true, "one"), snapshotFolderRow(2, nil, true, "two")}},
		{name: "default has parent", rows: []map[string]any{snapshotFolderRow(1, int64Pointer(2), true, "one"), snapshotFolderRow(2, nil, false, "two")}},
		{name: "self parent", rows: []map[string]any{snapshotFolderRow(1, nil, true, "root"), snapshotFolderRow(2, int64Pointer(2), false, "self")}},
		{name: "missing parent", rows: []map[string]any{snapshotFolderRow(1, nil, true, "root"), snapshotFolderRow(2, int64Pointer(99), false, "orphan")}},
		{name: "cycle", rows: []map[string]any{snapshotFolderRow(1, nil, true, "root"), snapshotFolderRow(2, int64Pointer(3), false, "two"), snapshotFolderRow(3, int64Pointer(2), false, "three")}},
		{name: "duplicate id", rows: []map[string]any{snapshotFolderRow(1, nil, true, "root"), snapshotFolderRow(1, nil, false, "copy")}},
	}
	assertSnapshotFolderRowsRejected(t, tests)
}

func TestValidateSnapshotRejectsMissingFolderFields(t *testing.T) {
	database := testutil.NewTestDB(t)
	base, err := newTestSyncService(database, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	for _, field := range []string{"id", "name", "parent_id", "is_default", "sort_order", "created_at", "updated_at"} {
		t.Run(field, func(t *testing.T) {
			row := snapshotFolderRow(1, nil, true, "root")
			delete(row, field)
			require.ErrorContains(t, validateSnapshot(database, snapshotWithFolderRows(base, []map[string]any{row})), field)
		})
	}
}

func assertSnapshotFolderCasesRejected(
	t *testing.T,
	tests []struct {
		name  string
		field string
		value any
	},
) {
	t.Helper()
	database := testutil.NewTestDB(t)
	base, err := newTestSyncService(database, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rows := validSnapshotFolderRows()
			rows[1][test.field] = test.value
			require.Error(t, validateSnapshot(database, snapshotWithFolderRows(base, rows)))
		})
	}
}

func assertSnapshotFolderRowsRejected(
	t *testing.T,
	tests []struct {
		name string
		rows []map[string]any
	},
) {
	t.Helper()
	database := testutil.NewTestDB(t)
	base, err := newTestSyncService(database, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Error(t, validateSnapshot(database, snapshotWithFolderRows(base, test.rows)))
		})
	}
}

func validSnapshotFolderRows() []map[string]any {
	return []map[string]any{
		snapshotFolderRow(1, nil, true, "root"),
		snapshotFolderRow(2, int64Pointer(1), false, "child"),
		snapshotFolderRow(3, int64Pointer(2), false, "grandchild"),
	}
}

func snapshotFolderRow(id int64, parentID *int64, isDefault bool, name string) map[string]any {
	defaultValue := int64(0)
	if isDefault {
		defaultValue = 1
	}
	var parentValue any
	if parentID != nil {
		parentValue = *parentID
	}
	return map[string]any{
		"id": id, "name": name, "parent_id": parentValue, "is_default": defaultValue, "sort_order": id - 1,
		"created_at": "2026-07-28 12:00:00", "updated_at": "2026-07-28 12:00:00",
	}
}

func snapshotWithFolderRows(base ExportData, rows []map[string]any) ExportData {
	data := base
	data.Tables = cloneSnapshotTables(base.Tables)
	data.Tables["session_folders"] = rows
	return data
}
