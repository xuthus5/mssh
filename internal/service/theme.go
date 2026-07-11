package service

import (
	"database/sql"
	"log/slog"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type ThemeService struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewThemeService(db *sql.DB, logger *slog.Logger) *ThemeService {
	return &ThemeService{db: db, logger: logger}
}

func (t *ThemeService) List() ([]model.Theme, error) {
	return store.ListThemes(t.db)
}

func (t *ThemeService) Create(input model.ThemeInput) (*model.Theme, error) {
	theme := input.Theme()
	t.logger.Info("creating theme", "name", theme.Name)
	return store.CreateTheme(t.db, theme)
}

func (t *ThemeService) Update(input model.ThemeInput) error {
	theme := input.Theme()
	t.logger.Info("updating theme", "id", theme.ID, "name", theme.Name)
	return store.UpdateTheme(t.db, theme)
}

func (t *ThemeService) Delete(id int64) error {
	t.logger.Info("deleting theme", "id", id)
	return store.DeleteTheme(t.db, id)
}

func (t *ThemeService) GetActive() (string, error) {
	t.logger.Info("getting active theme")
	return store.GetSetting(t.db, "active_theme")
}

func (t *ThemeService) SetActive(themeID string) error {
	t.logger.Info("setting active theme", "themeID", themeID)
	return store.SetSetting(t.db, "active_theme", themeID)
}
