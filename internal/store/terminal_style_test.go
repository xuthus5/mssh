package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestLoadTerminalGlobalStyleReportsAbsentStateAndRoundTrip(t *testing.T) {
	db := setupTestDB(t)
	style, exists, err := LoadTerminalGlobalStyle(db)
	require.NoError(t, err)
	assert.False(t, exists)
	assert.Equal(t, model.TerminalGlobalStyle{}, style)
	_, err = GetTerminalGlobalStyle(db)
	assert.ErrorContains(t, err, "not initialized")

	expected := model.TerminalGlobalStyle{
		FontFamily: "Iosevka", FontSize: 17, CursorStyle: model.CursorStyleUnderline,
	}
	require.NoError(t, SaveTerminalGlobalStyleDB(db, expected))
	loaded, exists, err := LoadTerminalGlobalStyle(db)
	require.NoError(t, err)
	assert.True(t, exists)
	assert.Equal(t, expected, loaded)
}

func TestLoadTerminalGlobalStyleRejectsIncompleteState(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, SaveTerminalGlobalStyleDB(db, model.TerminalGlobalStyle{}))
	_, err := db.Exec("DELETE FROM settings WHERE key = ?", terminalFontSizeKey)
	require.NoError(t, err)
	_, exists, err := LoadTerminalGlobalStyle(db)
	assert.True(t, exists)
	assert.ErrorContains(t, err, "incomplete")
}

func TestLoadTerminalGlobalStyleRejectsInvalidSettingContract(t *testing.T) {
	tests := []struct {
		name, query string
		args        []any
	}{
		{name: "namespace", query: "UPDATE settings SET namespace = 'terminal.style' WHERE key = ?", args: []any{terminalFontFamilyKey}},
		{name: "version", query: "UPDATE settings SET version = 2 WHERE key = ?", args: []any{terminalFontFamilyKey}},
		{name: "updated at", query: "UPDATE settings SET updated_at = 'invalid' WHERE key = ?", args: []any{terminalFontFamilyKey}},
		{name: "invalid json", query: "UPDATE settings SET value = '{' WHERE key = ?", args: []any{terminalFontFamilyKey}},
		{name: "actual type", query: "UPDATE settings SET value = 'true' WHERE key = ?", args: []any{terminalFontFamilyKey}},
		{name: "value type", query: "UPDATE settings SET value_type = 'number' WHERE key = ?", args: []any{terminalFontFamilyKey}},
		{name: "font family", query: "UPDATE settings SET value = '1', value_type = 'number' WHERE key = ?", args: []any{terminalFontFamilyKey}},
		{name: "font size", query: "UPDATE settings SET value = '\"large\"', value_type = 'string' WHERE key = ?", args: []any{terminalFontSizeKey}},
		{name: "cursor style", query: "UPDATE settings SET value = '1', value_type = 'number' WHERE key = ?", args: []any{terminalCursorStyleKey}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := setupTestDB(t)
			require.NoError(t, SaveTerminalGlobalStyleDB(db, model.TerminalGlobalStyle{}))
			_, err := db.Exec(test.query, test.args...)
			require.NoError(t, err)
			_, exists, err := LoadTerminalGlobalStyle(db)
			assert.True(t, exists)
			require.Error(t, err)
		})
	}
}

func TestTerminalGlobalStyleStoreReportsDatabaseErrors(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Close())
	_, _, err := LoadTerminalGlobalStyle(db)
	assert.ErrorContains(t, err, "read terminal global style")
	assert.ErrorContains(t, SaveTerminalGlobalStyleDB(db, model.TerminalGlobalStyle{}), "save terminal global style")
}
