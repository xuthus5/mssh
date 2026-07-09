package service

import (
	"database/sql"

	"mssh/internal/model"
	"mssh/internal/store"
)

type ThemeService struct {
	db *sql.DB
}

func NewThemeService(db *sql.DB) *ThemeService {
	return &ThemeService{db: db}
}

func (t *ThemeService) List() ([]model.Theme, error) {
	return store.ListThemes(t.db)
}

func (t *ThemeService) Create(theme model.Theme) (*model.Theme, error) {
	return store.CreateTheme(t.db, theme)
}

func (t *ThemeService) Update(theme model.Theme) error {
	return store.UpdateTheme(t.db, theme)
}

func (t *ThemeService) Delete(id int64) error {
	return store.DeleteTheme(t.db, id)
}

func (t *ThemeService) GetActive() (string, error) {
	return store.GetSetting(t.db, "active_theme")
}

func (t *ThemeService) SetActive(themeID string) error {
	return store.SetSetting(t.db, "active_theme", themeID)
}
