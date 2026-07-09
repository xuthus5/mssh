package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
	"mssh/internal/service/testutil"
)

func TestNewThemeService(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewThemeService(db)
	assert.NotNil(t, svc)
}

func TestThemeService_CRUD(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewThemeService(db)

	themes, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, themes, 0)

	theme := model.Theme{Name: "Dark", IsBuiltin: false, Config: `{"bg":"#000"}`}
	created, err := svc.Create(theme)
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	assert.Equal(t, "Dark", created.Name)
	assert.Equal(t, `{"bg":"#000"}`, created.Config)

	themes, err = svc.List()
	require.NoError(t, err)
	assert.Len(t, themes, 1)

	created.Name = "Dracula"
	created.Config = `{"bg":"#282a36"}`
	err = svc.Update(*created)
	require.NoError(t, err)

	themes, err = svc.List()
	require.NoError(t, err)
	assert.Equal(t, "Dracula", themes[0].Name)

	err = svc.Delete(created.ID)
	require.NoError(t, err)

	themes, err = svc.List()
	require.NoError(t, err)
	assert.Len(t, themes, 0)
}

func TestThemeService_GetActive(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewThemeService(db)

	active, err := svc.GetActive()
	require.NoError(t, err)
	assert.Equal(t, "", active)
}

func TestThemeService_SetActive(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewThemeService(db)

	err := svc.SetActive("dark")
	require.NoError(t, err)

	active, err := svc.GetActive()
	require.NoError(t, err)
	assert.Equal(t, "dark", active)
}

func TestThemeService_SetActiveOverride(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewThemeService(db)

	err := svc.SetActive("light")
	require.NoError(t, err)

	err = svc.SetActive("dark")
	require.NoError(t, err)

	active, err := svc.GetActive()
	require.NoError(t, err)
	assert.Equal(t, "dark", active)
}

func TestThemeService_CreateBuiltin(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewThemeService(db)

	theme := model.Theme{Name: "Default", IsBuiltin: true, Config: `{}`}
	created, err := svc.Create(theme)
	require.NoError(t, err)
	assert.True(t, created.IsBuiltin)
}
