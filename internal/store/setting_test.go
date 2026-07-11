package store

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestTypedSettingsLifecycle(t *testing.T) {
	db := setupTestDB(t)
	settings := []model.Setting{
		{Key: "appearance.color_mode", Namespace: "appearance", Value: `"light"`, ValueType: "string", Version: 1},
		{Key: "terminal.max_pool_size", Namespace: "terminal", Value: `32`, ValueType: "number", Version: 1},
	}
	require.NoError(t, SetSettings(db, settings))

	loaded, err := GetSettings(db, []string{"appearance.color_mode", "terminal.max_pool_size", "missing.key"})
	require.NoError(t, err)
	assert.Equal(t, `"light"`, loaded["appearance.color_mode"].Value)
	assert.Equal(t, "number", loaded["terminal.max_pool_size"].ValueType)

	appearance, err := ListSettings(db, "appearance")
	require.NoError(t, err)
	require.Len(t, appearance, 1)
	assert.Equal(t, "appearance.color_mode", appearance[0].Key)

	require.NoError(t, DeleteSetting(db, "appearance.color_mode"))
	setting, err := GetSettingEntry(db, "appearance.color_mode")
	require.NoError(t, err)
	assert.Nil(t, setting)
}

func TestSetSettingsRejectsInvalidBatch(t *testing.T) {
	db := setupTestDB(t)
	err := SetSettings(db, []model.Setting{
		{Key: "appearance.color_mode", Namespace: "appearance", Value: `"dark"`, ValueType: "string", Version: 1},
		{Key: "invalid", Namespace: "appearance", Value: `{`, ValueType: "object", Version: 1},
	})
	require.Error(t, err)
	setting, getErr := GetSettingEntry(db, "appearance.color_mode")
	require.NoError(t, getErr)
	assert.Nil(t, setting)
}

func TestMigrateRebuildsLegacySettingsTable(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.Exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO settings (key, value) VALUES ('old', 'value')")
	require.NoError(t, err)
	require.NoError(t, Migrate(db))
	var count int
	require.NoError(t, db.QueryRow("SELECT count(*) FROM settings").Scan(&count))
	assert.Zero(t, count)
	_, err = db.Exec("INSERT INTO settings (key, namespace, value, value_type, version) VALUES ('appearance.color_mode', 'appearance', '\"dark\"', 'string', 1)")
	require.NoError(t, err)
}

func TestEnsureSettingsSchemaPreservesCurrentTable(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, SetSetting(db, "appearance.color_mode", "dark"))
	require.NoError(t, ensureSettingsSchema(db))

	value, err := GetSetting(db, "appearance.color_mode")
	require.NoError(t, err)
	assert.Equal(t, "dark", value)
}

func TestValidateSetting(t *testing.T) {
	tests := []struct {
		name    string
		setting model.Setting
	}{
		{name: "empty key", setting: model.Setting{Namespace: "appearance", Value: `null`, ValueType: "null", Version: 1}},
		{name: "empty namespace", setting: model.Setting{Key: "appearance.mode", Value: `null`, ValueType: "null", Version: 1}},
		{name: "namespace mismatch", setting: model.Setting{Key: "terminal.mode", Namespace: "appearance", Value: `null`, ValueType: "null", Version: 1}},
		{name: "invalid version", setting: model.Setting{Key: "appearance.mode", Namespace: "appearance", Value: `null`, ValueType: "null"}},
		{name: "invalid json", setting: model.Setting{Key: "appearance.mode", Namespace: "appearance", Value: `{`, ValueType: "object", Version: 1}},
		{name: "invalid type", setting: model.Setting{Key: "appearance.mode", Namespace: "appearance", Value: `null`, ValueType: "invalid", Version: 1}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Error(t, validateSetting(test.setting))
		})
	}
}

func TestSettingsDatabaseErrors(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Close())

	_, err := GetSettingEntry(db, "appearance.mode")
	require.Error(t, err)
	_, err = GetSettings(db, []string{"appearance.mode"})
	require.Error(t, err)
	_, err = ListSettings(db, "appearance")
	require.Error(t, err)
	err = SetSettings(db, []model.Setting{{Key: "appearance.mode", Namespace: "appearance", Value: `"dark"`, ValueType: "string", Version: 1}})
	require.Error(t, err)
	require.Error(t, DeleteSetting(db, "appearance.mode"))
	require.Error(t, ensureSettingsSchema(db))
}

func TestSettingsRejectMalformedTimestamp(t *testing.T) {
	db := setupTestDB(t)
	_, err := db.Exec("INSERT INTO settings (key, namespace, value, value_type, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "appearance.mode", "appearance", `"dark"`, "string", 1, "invalid")
	require.NoError(t, err)

	_, err = GetSettingEntry(db, "appearance.mode")
	require.Error(t, err)
	_, err = ListSettings(db, "appearance")
	require.Error(t, err)
}

func TestGetSettingReturnsRawJSONValue(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, SetSettings(db, []model.Setting{{Key: "terminal.size", Namespace: "terminal", Value: `42`, ValueType: "number", Version: 1}}))

	value, err := GetSetting(db, "terminal.size")
	require.NoError(t, err)
	assert.Equal(t, "42", value)
}

func TestEnsureSettingsSchemaBeginError(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	require.NoError(t, err)
	require.NoError(t, db.Close())
	require.Error(t, ensureSettingsSchema(db))
}
