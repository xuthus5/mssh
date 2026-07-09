package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
)

func TestCreateAndListMacros(t *testing.T) {
	db := setupTestDB(t)
	m := model.Macro{
		Name: "Clear Screen", Command: "clear\r", Shortcut: "Ctrl+L", DelayMs: 50, SortOrder: 1,
	}
	created, err := CreateMacro(db, m)
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	assert.Equal(t, "Clear Screen", created.Name)

	macros, err := ListMacros(db)
	require.NoError(t, err)
	assert.Len(t, macros, 1)
	assert.Equal(t, "Clear Screen", macros[0].Name)
	assert.Equal(t, 50, macros[0].DelayMs)
}

func TestUpdateMacro(t *testing.T) {
	db := setupTestDB(t)
	m := model.Macro{
		Name: "Old", Command: "old\r", Shortcut: "Ctrl+O", DelayMs: 10, SortOrder: 0,
	}
	created, err := CreateMacro(db, m)
	require.NoError(t, err)

	created.Name = "Updated"
	created.Command = "new\r"
	err = UpdateMacro(db, *created)
	require.NoError(t, err)

	macros, err := ListMacros(db)
	require.NoError(t, err)
	assert.Len(t, macros, 1)
	assert.Equal(t, "Updated", macros[0].Name)
	assert.Equal(t, "new\r", macros[0].Command)
}

func TestDeleteMacro(t *testing.T) {
	db := setupTestDB(t)
	m := model.Macro{Name: "Temp", Command: "temp\r", DelayMs: 0, SortOrder: 0}
	created, err := CreateMacro(db, m)
	require.NoError(t, err)

	err = DeleteMacro(db, created.ID)
	require.NoError(t, err)

	macros, err := ListMacros(db)
	require.NoError(t, err)
	assert.Len(t, macros, 0)
}

func TestListMacrosEmpty(t *testing.T) {
	db := setupTestDB(t)
	macros, err := ListMacros(db)
	require.NoError(t, err)
	assert.Len(t, macros, 0)
}
