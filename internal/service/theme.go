package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const defaultTerminalFont = `"JetBrains Mono", "Cascadia Code", monospace`

type ThemeService struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewThemeService(db *sql.DB, logger *slog.Logger) *ThemeService {
	return &ThemeService{db: db, logger: logger}
}

func (service *ThemeService) ListDefinitions(mode string) ([]model.ThemeDefinition, error) {
	parsed, err := parseThemeMode(mode)
	if err != nil {
		return nil, err
	}
	return store.ListThemeDefinitions(service.db, parsed)
}

func (service *ThemeService) ListProfiles(mode string) ([]model.ThemeProfile, error) {
	parsed, err := parseThemeMode(mode)
	if err != nil {
		return nil, err
	}
	return store.ListThemeProfiles(service.db, parsed)
}

func (service *ThemeService) GetProfile(id int64) (*model.ThemeProfile, error) {
	return store.GetThemeProfile(service.db, id)
}

func (service *ThemeService) CreateCustomProfile(input model.ThemeProfileInput) (*model.ThemeProfile, error) {
	profile := input.ThemeProfile()
	if err := validateThemeProfile(profile); err != nil {
		return nil, err
	}
	return store.CreateThemeProfile(service.db, profile)
}

func (service *ThemeService) UpdateProfile(input model.ThemeProfileInput) error {
	profile := input.ThemeProfile()
	if err := validateThemeProfile(profile); err != nil {
		return err
	}
	return store.UpdateThemeProfile(service.db, profile)
}

func (service *ThemeService) DeleteProfile(id int64) error {
	return store.DeleteThemeProfile(service.db, id)
}

func (service *ThemeService) DeleteDefinition(id int64) error {
	return store.DeleteThemeDefinition(service.db, id)
}

func (service *ThemeService) GetAssignments() (model.ThemeAssignments, error) {
	if err := service.InitializeDefaults(); err != nil {
		return model.ThemeAssignments{}, err
	}
	return store.GetThemeAssignments(service.db)
}

func (service *ThemeService) SaveAssignments(input model.ThemeAssignmentsInput) error {
	assignments := input.ThemeAssignments()
	_, err := store.GetThemeProfile(service.db, assignments.DarkProfileID)
	if err != nil {
		return fmt.Errorf("dark theme profile: %w", err)
	}
	_, err = store.GetThemeProfile(service.db, assignments.LightProfileID)
	if err != nil {
		return fmt.Errorf("light theme profile: %w", err)
	}
	return store.SaveThemeAssignments(service.db, assignments)
}

func (service *ThemeService) SaveConfiguration(input model.ThemeConfigurationInput) error {
	dark := input.DarkProfile.ThemeProfile()
	light := input.LightProfile.ThemeProfile()
	if err := validateThemeProfile(dark); err != nil {
		return fmt.Errorf("dark profile: %w", err)
	}
	if err := validateThemeProfile(light); err != nil {
		return fmt.Errorf("light profile: %w", err)
	}
	tx, err := service.db.Begin()
	if err != nil {
		return fmt.Errorf("begin theme configuration: %w", err)
	}
	if err = store.UpdateThemeProfile(tx, dark); err == nil {
		err = store.UpdateThemeProfile(tx, light)
	}
	if err == nil {
		err = store.SaveThemeAssignmentsDB(tx, input.Assignments.ThemeAssignments())
	}
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("save theme configuration: %w", err)
	}
	return tx.Commit()
}

func validateThemeProfile(profile model.ThemeProfile) error {
	if profile.Name == "" || profile.ThemeID < 1 || profile.FontFamily == "" {
		return fmt.Errorf("theme profile name, definition, and font are required")
	}
	if profile.FontSize < 8 || profile.FontSize > 48 {
		return fmt.Errorf("theme profile font size must be between 8 and 48")
	}
	if profile.CursorStyle != model.CursorStyleBar && profile.CursorStyle != model.CursorStyleBlock && profile.CursorStyle != model.CursorStyleUnderline {
		return fmt.Errorf("invalid theme profile cursor style")
	}
	if !json.Valid([]byte(profile.ColorOverrides)) {
		return fmt.Errorf("invalid theme profile color overrides")
	}
	return nil
}

func parseThemeMode(value string) (model.ThemeMode, error) {
	mode := model.ThemeMode(value)
	if mode == "" || mode == model.ThemeModeDark || mode == model.ThemeModeLight || mode == model.ThemeModeUniversal {
		return mode, nil
	}
	return "", fmt.Errorf("invalid theme mode %q", value)
}
