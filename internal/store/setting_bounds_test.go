package store

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	testMaxSettingBatchEntries   = 256
	testMaxSettingKeyBytes       = 256
	testMaxSettingNamespaceBytes = 64
	testMaxSettingValueBytes     = 64 * 1024
)

func TestValidateSettingAcceptsResourceBoundaries(t *testing.T) {
	settings := []model.Setting{
		settingForBounds("n."+strings.Repeat("k", testMaxSettingKeyBytes-2), "n", `null`),
		settingForBounds(strings.Repeat("n", testMaxSettingNamespaceBytes)+".key", strings.Repeat("n", testMaxSettingNamespaceBytes), `null`),
		settingForBounds("test.value", "test", `"`+strings.Repeat("v", testMaxSettingValueBytes-2)+`"`),
	}
	for _, setting := range settings {
		require.NoError(t, validateSetting(setting))
	}

	batch := makeBoundedSettings(testMaxSettingBatchEntries)
	require.NoError(t, validateSettings(batch))
}

func TestValidateSettingRejectsResourceBoundaryViolations(t *testing.T) {
	tests := []struct {
		name    string
		setting model.Setting
	}{
		{
			name:    "oversized key",
			setting: settingForBounds("n."+strings.Repeat("k", testMaxSettingKeyBytes-1), "n", `null`),
		},
		{
			name: "oversized namespace",
			setting: settingForBounds(
				strings.Repeat("n", testMaxSettingNamespaceBytes+1)+".key",
				strings.Repeat("n", testMaxSettingNamespaceBytes+1),
				`null`,
			),
		},
		{
			name:    "oversized value",
			setting: settingForBounds("test.value", "test", `"`+strings.Repeat("v", testMaxSettingValueBytes-1)+`"`),
		},
		{
			name:    "invalid key utf8",
			setting: settingForBounds("test."+string([]byte{0xff}), "test", `null`),
		},
		{
			name:    "invalid namespace utf8",
			setting: settingForBounds(string([]byte{0xff})+".key", string([]byte{0xff}), `null`),
		},
		{
			name:    "invalid value utf8",
			setting: settingForBounds("test.value", "test", `"`+string([]byte{0xff})+`"`),
		},
		{
			name: "oversized declared value type",
			setting: model.Setting{
				Key: "test.value_type", Namespace: "test", Value: `null`,
				ValueType: strings.Repeat("x", testMaxSettingValueBytes), Version: 1,
			},
		},
		{
			name:    "key contains NUL",
			setting: settingForBounds("test.bad\x00key", "test", `null`),
		},
		{
			name:    "namespace contains NUL",
			setting: settingForBounds("test\x00.key", "test\x00", `null`),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Error(t, validateSetting(test.setting))
		})
	}
}

func TestValidateSettingsRejectsOversizedAndDuplicateBatches(t *testing.T) {
	assert.Error(t, validateSettings(makeBoundedSettings(testMaxSettingBatchEntries+1)))
	assert.Error(t, validateSettings([]model.Setting{
		settingForBounds("test.duplicate", "test", `1`),
		settingForBounds("test.duplicate", "test", `2`),
	}))
}

func TestSettingValueTypeRejectsUnsupportedGoValue(t *testing.T) {
	_, err := settingValueType(struct{}{})
	require.Error(t, err)
	require.NoError(t, validateDeclaredSettingValueType("object"))
	require.Error(t, validateDeclaredSettingValueType("invalid"))
}

func settingForBounds(key, namespace, value string) model.Setting {
	return model.Setting{Key: key, Namespace: namespace, Value: value, ValueType: settingTypeForBounds(value), Version: 1}
}

func settingTypeForBounds(value string) string {
	if value == `null` {
		return "null"
	}
	if strings.HasPrefix(value, `"`) {
		return "string"
	}
	return "number"
}

func makeBoundedSettings(count int) []model.Setting {
	settings := make([]model.Setting, count)
	for index := range settings {
		settings[index] = settingForBounds(fmt.Sprintf("test.key_%03d", index), "test", `null`)
	}
	return settings
}
