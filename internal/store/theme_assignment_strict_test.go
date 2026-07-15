package store

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestSaveThemeAssignmentsDBCanonicalizesEveryUpsertField(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, SaveThemeAssignments(db, model.ThemeAssignments{}))
	_, err := db.Exec(`UPDATE settings SET namespace = 'terminal.theme', value = 'null', value_type = 'null', version = 2, updated_at = '2000-01-01 00:00:00' WHERE key LIKE 'terminal.theme.%'`)
	require.NoError(t, err)

	expected := model.ThemeAssignments{
		DarkProfileID: 3, LightProfileID: 5, FollowInterfaceMode: false, FixedProfileID: 7,
	}
	require.NoError(t, SaveThemeAssignmentsDB(db, expected))

	rows, err := db.Query(`SELECT key, namespace, value, value_type, version, updated_at FROM settings WHERE key LIKE 'terminal.theme.%' ORDER BY key`)
	require.NoError(t, err)
	defer func() { require.NoError(t, rows.Close()) }()
	wants := map[string]struct{ value, valueType string }{
		darkThemeProfileKey:  {value: "3", valueType: "number"},
		lightThemeProfileKey: {value: "5", valueType: "number"},
		followThemeModeKey:   {value: "false", valueType: "boolean"},
		fixedThemeProfileKey: {value: "7", valueType: "number"},
	}
	count := 0
	for rows.Next() {
		var key, namespace, value, valueType, updatedAt string
		var version int
		require.NoError(t, rows.Scan(&key, &namespace, &value, &valueType, &version, &updatedAt))
		want := wants[key]
		assert.Equal(t, "terminal", namespace)
		assert.Equal(t, want.value, value)
		assert.Equal(t, want.valueType, valueType)
		assert.Equal(t, 1, version)
		_, err = time.Parse("2006-01-02 15:04:05", updatedAt)
		require.NoError(t, err)
		assert.NotEqual(t, "2000-01-01 00:00:00", updatedAt)
		count++
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, len(wants), count)
}
