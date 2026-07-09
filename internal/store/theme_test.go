package store

import (
	"mssh/internal/model"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateAndListThemes(t *testing.T) {
	db := setupTestDB(t)
	th := model.Theme{
		Name: "Dark Mode", IsBuiltin: false,
		Config: `{"bg":"#1e1e1e","fg":"#d4d4d4"}`,
	}
	created, err := CreateTheme(db, th)
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	assert.Equal(t, "Dark Mode", created.Name)

	themes, err := ListThemes(db)
	require.NoError(t, err)
	assert.Len(t, themes, 1)
	assert.Equal(t, "Dark Mode", themes[0].Name)
	assert.False(t, themes[0].IsBuiltin)
}

func TestUpdateTheme(t *testing.T) {
	db := setupTestDB(t)
	th := model.Theme{
		Name: "Old Theme", IsBuiltin: false,
		Config: `{"bg":"#fff"}`,
	}
	created, err := CreateTheme(db, th)
	require.NoError(t, err)

	created.Name = "Updated Theme"
	created.Config = `{"bg":"#000"}`
	err = UpdateTheme(db, *created)
	require.NoError(t, err)

	themes, err := ListThemes(db)
	require.NoError(t, err)
	assert.Len(t, themes, 1)
	assert.Equal(t, "Updated Theme", themes[0].Name)
	assert.Equal(t, `{"bg":"#000"}`, themes[0].Config)
}

func TestDeleteTheme(t *testing.T) {
	db := setupTestDB(t)
	th := model.Theme{
		Name: "Temp Theme", IsBuiltin: true,
		Config: `{"bg":"#333"}`,
	}
	created, err := CreateTheme(db, th)
	require.NoError(t, err)

	err = DeleteTheme(db, created.ID)
	require.NoError(t, err)

	themes, err := ListThemes(db)
	require.NoError(t, err)
	assert.Len(t, themes, 0)
}

func TestListThemesEmpty(t *testing.T) {
	db := setupTestDB(t)
	themes, err := ListThemes(db)
	require.NoError(t, err)
	assert.Len(t, themes, 0)
}
