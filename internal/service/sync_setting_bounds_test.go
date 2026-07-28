package service

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestValidateSnapshotAcceptsBoundedSettingsBeforeAndAfterJSON(t *testing.T) {
	db := testutil.NewTestDB(t)
	data, err := newTestSyncService(db, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	data.Tables["settings"] = []map[string]any{snapshotSettingRow("test.mode", `"safe"`)}
	require.NoError(t, validateSnapshot(db, data))

	content, err := json.Marshal(data)
	require.NoError(t, err)
	var decoded ExportData
	require.NoError(t, decodeSnapshot(content, &decoded))
	require.NoError(t, validateSnapshot(db, decoded))
}

func TestValidateSnapshotRejectsInvalidSettingRows(t *testing.T) {
	db := testutil.NewTestDB(t)
	base, err := newTestSyncService(db, syncTestMasterKey).snapshot()
	require.NoError(t, err)

	tests := []struct {
		name string
		rows []map[string]any
	}{
		{
			name: "oversized key",
			rows: []map[string]any{snapshotSettingRow("n."+strings.Repeat("k", testSettingKeyLimit-1), `null`)},
		},
		{
			name: "oversized namespace",
			rows: []map[string]any{snapshotSettingRowWithNamespace(
				strings.Repeat("n", testSettingNamespaceLimit+1)+".key",
				strings.Repeat("n", testSettingNamespaceLimit+1),
				`null`,
			)},
		},
		{
			name: "oversized value",
			rows: []map[string]any{snapshotSettingRow("test.large", `"`+strings.Repeat("v", testSettingValueLimit-1)+`"`)},
		},
		{
			name: "duplicate key",
			rows: []map[string]any{snapshotSettingRow("test.duplicate", `1`), snapshotSettingRow("test.duplicate", `2`)},
		},
		{
			name: "oversized batch",
			rows: makeSnapshotSettingRows(testSettingBatchLimit + 1),
		},
		{
			name: "missing key",
			rows: []map[string]any{{
				"namespace": "test", "value": `null`, "value_type": "null", "version": int64(1), "updated_at": "2026-07-28 12:00:00",
			}},
		},
		{
			name: "missing namespace",
			rows: []map[string]any{{
				"key": "test.mode", "value": `null`, "value_type": "null", "version": int64(1), "updated_at": "2026-07-28 12:00:00",
			}},
		},
		{
			name: "missing value",
			rows: []map[string]any{{
				"key": "test.mode", "namespace": "test", "value_type": "null", "version": int64(1), "updated_at": "2026-07-28 12:00:00",
			}},
		},
		{
			name: "missing value type",
			rows: []map[string]any{{
				"key": "test.mode", "namespace": "test", "value": `null`, "version": int64(1), "updated_at": "2026-07-28 12:00:00",
			}},
		},
		{
			name: "oversized value type",
			rows: []map[string]any{{
				"key": "test.mode", "namespace": "test", "value": `null`, "value_type": strings.Repeat("x", testSettingValueLimit),
				"version": int64(1), "updated_at": "2026-07-28 12:00:00",
			}},
		},
		{
			name: "missing version",
			rows: []map[string]any{{
				"key": "test.mode", "namespace": "test", "value": `null`, "value_type": "null", "updated_at": "2026-07-28 12:00:00",
			}},
		},
		{
			name: "fractional version",
			rows: []map[string]any{{
				"key": "test.mode", "namespace": "test", "value": `null`, "value_type": "null", "version": 1.5, "updated_at": "2026-07-28 12:00:00",
			}},
		},
		{
			name: "string version",
			rows: []map[string]any{{
				"key": "test.mode", "namespace": "test", "value": `null`, "value_type": "null", "version": "1", "updated_at": "2026-07-28 12:00:00",
			}},
		},
		{
			name: "missing timestamp",
			rows: []map[string]any{{
				"key": "test.mode", "namespace": "test", "value": `null`, "value_type": "null", "version": int64(1),
			}},
		},
		{
			name: "invalid timestamp",
			rows: []map[string]any{{
				"key": "test.mode", "namespace": "test", "value": `null`, "value_type": "null", "version": int64(1), "updated_at": "invalid",
			}},
		},
		{
			name: "non string key",
			rows: []map[string]any{{
				"key": 1, "namespace": "test", "value": `null`, "value_type": "null", "version": int64(1), "updated_at": "2026-07-28 12:00:00",
			}},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			data := base
			data.Tables = cloneSnapshotTables(base.Tables)
			data.Tables["settings"] = test.rows
			require.Error(t, validateSnapshot(db, data))
		})
	}
}

func snapshotSettingRow(key, value string) map[string]any {
	return snapshotSettingRowWithNamespace(key, strings.SplitN(key, ".", 2)[0], value)
}

func snapshotSettingRowWithNamespace(key, namespace, value string) map[string]any {
	valueType := "number"
	if value == `null` {
		valueType = "null"
	} else if strings.HasPrefix(value, `"`) {
		valueType = "string"
	}
	return map[string]any{
		"key": key, "namespace": namespace, "value": value, "value_type": valueType,
		"version": int64(1), "updated_at": "2026-07-28 12:00:00",
	}
}

func makeSnapshotSettingRows(count int) []map[string]any {
	rows := make([]map[string]any, count)
	for index := range rows {
		rows[index] = snapshotSettingRow(fmt.Sprintf("test.key_%03d", index), `null`)
	}
	return rows
}

func cloneSnapshotTables(tables map[string][]map[string]any) map[string][]map[string]any {
	cloned := make(map[string][]map[string]any, len(tables))
	for table, rows := range tables {
		cloned[table] = rows
	}
	return cloned
}
