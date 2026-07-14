package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestTerminalGlobalStyleStoreDefaultsAndRoundTrip(t *testing.T) {
	db := setupTestDB(t)
	style, err := GetTerminalGlobalStyle(db)
	require.NoError(t, err)
	assert.Equal(t, model.TerminalGlobalStyle{
		FontFamily:  model.DefaultTerminalFontFamily,
		FontSize:    model.DefaultTerminalFontSize,
		CursorStyle: model.CursorStyleBar,
	}, style)

	expected := model.TerminalGlobalStyle{FontFamily: "Iosevka", FontSize: 17, CursorStyle: model.CursorStyleUnderline}
	require.NoError(t, SaveTerminalGlobalStyleDB(db, expected))
	loaded, err := GetTerminalGlobalStyle(db)
	require.NoError(t, err)
	assert.Equal(t, expected, loaded)

	_, err = db.Exec("DELETE FROM settings WHERE key = ?", terminalFontSizeKey)
	require.NoError(t, err)
	loaded, err = GetTerminalGlobalStyle(db)
	require.NoError(t, err)
	assert.Equal(t, model.DefaultTerminalFontSize, loaded.FontSize)
	assert.Equal(t, expected.FontFamily, loaded.FontFamily)
}

func TestTerminalGlobalStyleStoreReportsMalformedValuesAndDatabaseErrors(t *testing.T) {
	db := setupTestDB(t)
	_, err := db.Exec(`INSERT INTO settings (key, namespace, value, value_type, version) VALUES (?, 'terminal', '"large"', 'number', 1)`, terminalFontSizeKey)
	require.NoError(t, err)
	_, err = GetTerminalGlobalStyle(db)
	assert.ErrorContains(t, err, terminalFontSizeKey)

	require.NoError(t, db.Close())
	_, err = GetTerminalGlobalStyle(db)
	assert.ErrorContains(t, err, "read terminal global style")
}
