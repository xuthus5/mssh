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

func TestValidateSetting(t *testing.T) {
	tests := []struct {
		name    string
		setting model.Setting
	}{
		{name: "empty key", setting: model.Setting{Namespace: "appearance", Value: `null`, ValueType: "null", Version: 1}},
		{name: "empty namespace", setting: model.Setting{Key: "appearance.mode", Value: `null`, ValueType: "null", Version: 1}},
		{name: "legacy namespace", setting: model.Setting{Key: "max_pool_size", Namespace: "legacy", Value: `32`, ValueType: "number", Version: 1}},
		{name: "unprefixed key", setting: model.Setting{Key: "max_pool_size", Namespace: "terminal", Value: `32`, ValueType: "number", Version: 1}},
		{name: "namespace mismatch", setting: model.Setting{Key: "terminal.mode", Namespace: "appearance", Value: `null`, ValueType: "null", Version: 1}},
		{name: "missing version", setting: model.Setting{Key: "appearance.mode", Namespace: "appearance", Value: `null`, ValueType: "null"}},
		{name: "unsupported version", setting: model.Setting{Key: "appearance.mode", Namespace: "appearance", Value: `null`, ValueType: "null", Version: 2}},
		{name: "invalid json", setting: model.Setting{Key: "appearance.mode", Namespace: "appearance", Value: `{`, ValueType: "object", Version: 1}},
		{name: "invalid type", setting: model.Setting{Key: "appearance.mode", Namespace: "appearance", Value: `null`, ValueType: "invalid", Version: 1}},
		{name: "mismatched type", setting: model.Setting{Key: "appearance.mode", Namespace: "appearance", Value: `true`, ValueType: "string", Version: 1}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Error(t, validateSetting(test.setting))
		})
	}
}

func TestValidateSettingAcceptsMatchingJSONTypes(t *testing.T) {
	settings := []model.Setting{
		{Key: "test.string", Namespace: "test", Value: `"value"`, ValueType: "string", Version: 1},
		{Key: "test.number", Namespace: "test", Value: `1.5`, ValueType: "number", Version: 1},
		{Key: "test.boolean", Namespace: "test", Value: `true`, ValueType: "boolean", Version: 1},
		{Key: "test.array", Namespace: "test", Value: `[]`, ValueType: "array", Version: 1},
		{Key: "test.object", Namespace: "test", Value: `{}`, ValueType: "object", Version: 1},
		{Key: "test.null", Namespace: "test", Value: `null`, ValueType: "null", Version: 1},
	}
	for _, setting := range settings {
		require.NoError(t, validateSetting(setting), setting.ValueType)
	}
}

func TestSettingsReadsRejectInvalidFinalContract(t *testing.T) {
	tests := []storedSettingFixture{
		{name: "namespace mismatch", key: "terminal.mode", namespace: "appearance", value: `"dark"`, valueType: "string", version: 1, updatedAt: "2026-07-15 10:00:00"},
		{name: "legacy namespace", key: "legacy.mode", namespace: "legacy", value: `"dark"`, valueType: "string", version: 1, updatedAt: "2026-07-15 10:00:00"},
		{name: "unsupported version", key: "appearance.mode", namespace: "appearance", value: `"dark"`, valueType: "string", version: 2, updatedAt: "2026-07-15 10:00:00"},
		{name: "invalid json", key: "appearance.mode", namespace: "appearance", value: `{`, valueType: "object", version: 1, updatedAt: "2026-07-15 10:00:00"},
		{name: "invalid value type", key: "appearance.mode", namespace: "appearance", value: `"dark"`, valueType: "invalid", version: 1, updatedAt: "2026-07-15 10:00:00"},
		{name: "mismatched value type", key: "appearance.mode", namespace: "appearance", value: `true`, valueType: "string", version: 1, updatedAt: "2026-07-15 10:00:00"},
		{name: "invalid timestamp", key: "appearance.mode", namespace: "appearance", value: `"dark"`, valueType: "string", version: 1, updatedAt: "invalid"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := setupTestDB(t)
			insertStoredSetting(t, db, test)
			assertSettingReadsFail(t, db, test)
		})
	}
}

type storedSettingFixture struct {
	name, key, namespace, value, valueType, updatedAt string
	version                                           int
}

func insertStoredSetting(t *testing.T, db *sql.DB, setting storedSettingFixture) {
	t.Helper()
	_, err := db.Exec("PRAGMA ignore_check_constraints = ON")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO settings (key, namespace, value, value_type, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)", setting.key, setting.namespace, setting.value, setting.valueType, setting.version, setting.updatedAt)
	require.NoError(t, err)
}

func assertSettingReadsFail(t *testing.T, db *sql.DB, setting storedSettingFixture) {
	t.Helper()
	_, err := GetSettingEntry(db, setting.key)
	require.Error(t, err)
	_, err = GetSettings(db, []string{setting.key})
	require.Error(t, err)
	_, err = ListSettings(db, setting.namespace)
	require.Error(t, err)
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
