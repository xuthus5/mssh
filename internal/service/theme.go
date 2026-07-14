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

type themeDatabase interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
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
	tx, err := service.db.Begin()
	if err != nil {
		return fmt.Errorf("begin delete theme profile: %w", err)
	}
	if err = store.DeleteThemeProfile(tx, id); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("delete theme profile: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit delete theme profile: %w", err)
	}
	return nil
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
	tx, err := service.db.Begin()
	if err != nil {
		return fmt.Errorf("begin save theme assignments: %w", err)
	}
	if err = validateThemeAssignments(tx, assignments); err == nil {
		err = store.SaveThemeAssignmentsDB(tx, assignments)
	}
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("save theme assignments: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit theme assignments: %w", err)
	}
	return nil
}

func (service *ThemeService) SaveConfiguration(input model.ThemeConfigurationInput) error {
	profiles, err := validatedThemeProfiles(input.Profiles)
	if err != nil {
		return err
	}
	tx, err := service.db.Begin()
	if err != nil {
		return fmt.Errorf("begin theme configuration: %w", err)
	}
	assignments := input.Assignments.ThemeAssignments()
	if err = validateThemeAssignments(tx, assignments); err == nil {
		for _, profile := range profiles {
			if err = store.UpdateThemeProfile(tx, profile); err != nil {
				break
			}
		}
	}
	if err == nil {
		err = store.SaveThemeAssignmentsDB(tx, assignments)
	}
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("save theme configuration: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit theme configuration: %w", err)
	}
	return nil
}

func validatedThemeProfiles(inputs []model.ThemeProfileInput) ([]model.ThemeProfile, error) {
	profiles := make([]model.ThemeProfile, 0, len(inputs))
	seen := make(map[int64]struct{}, len(inputs))
	for _, input := range inputs {
		profile := input.ThemeProfile()
		if _, duplicate := seen[profile.ID]; duplicate {
			return nil, fmt.Errorf("duplicate theme profile %d", profile.ID)
		}
		if err := validateThemeProfile(profile); err != nil {
			return nil, fmt.Errorf("theme profile %d: %w", profile.ID, err)
		}
		seen[profile.ID] = struct{}{}
		profiles = append(profiles, profile)
	}
	return profiles, nil
}

func validateThemeAssignments(db themeDatabase, assignments model.ThemeAssignments) error {
	checks := []struct {
		label string
		id    int64
	}{{label: "dark", id: assignments.DarkProfileID}, {label: "light", id: assignments.LightProfileID}}
	if !assignments.FollowInterfaceMode {
		if assignments.FixedProfileID < 1 {
			return fmt.Errorf("fixed theme profile is required when follow mode is disabled")
		}
		checks = append(checks, struct {
			label string
			id    int64
		}{label: "fixed", id: assignments.FixedProfileID})
	}
	for _, check := range checks {
		if _, err := store.GetThemeProfile(db, check.id); err != nil {
			return fmt.Errorf("%s theme profile: %w", check.label, err)
		}
	}
	return nil
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
