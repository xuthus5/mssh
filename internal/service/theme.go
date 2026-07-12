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

func (service *ThemeService) InitializeDefaults() error {
	darkID, err := service.ensureBuiltin(defaultDarkDefinition())
	if err != nil {
		return err
	}
	lightID, err := service.ensureBuiltin(defaultLightDefinition())
	if err != nil {
		return err
	}
	darkProfileID, err := service.ensureProfile("GitHub Dark", darkID)
	if err != nil {
		return err
	}
	lightProfileID, err := service.ensureProfile("GitHub Light", lightID)
	if err != nil {
		return err
	}
	assignments, err := store.GetThemeAssignments(service.db)
	if err != nil {
		return err
	}
	if assignments.DarkProfileID == 0 || service.profileMissing(assignments.DarkProfileID) {
		assignments.DarkProfileID = darkProfileID
	}
	if assignments.LightProfileID == 0 || service.profileMissing(assignments.LightProfileID) {
		assignments.LightProfileID = lightProfileID
	}
	return store.SaveThemeAssignments(service.db, assignments)
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

func (service *ThemeService) ensureBuiltin(definition model.ThemeDefinition) (int64, error) {
	definitions, err := store.ListThemeDefinitions(service.db, "")
	if err != nil {
		return 0, err
	}
	for _, existing := range definitions {
		if existing.SourceFingerprint == definition.SourceFingerprint {
			return existing.ID, nil
		}
	}
	created, err := store.CreateThemeDefinition(service.db, definition)
	if err != nil {
		return 0, err
	}
	return created.ID, nil
}

func (service *ThemeService) ensureProfile(name string, themeID int64) (int64, error) {
	profiles, err := store.ListThemeProfiles(service.db, "")
	if err != nil {
		return 0, err
	}
	for _, profile := range profiles {
		if profile.ThemeID == themeID {
			return profile.ID, nil
		}
	}
	created, err := store.CreateThemeProfile(service.db, model.ThemeProfile{Name: name, ThemeID: themeID, FontFamily: defaultTerminalFont, FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`})
	if err != nil {
		return 0, err
	}
	return created.ID, nil
}

func (service *ThemeService) profileMissing(id int64) bool {
	_, err := store.GetThemeProfile(service.db, id)
	return err != nil
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

func defaultDarkDefinition() model.ThemeDefinition {
	return builtinDefinition("GitHub Dark", model.ThemeModeDark, "builtin:github-dark:v1", model.TerminalColorPayload{Background: "#0d1117", Foreground: "#c9d1d9", Cursor: "#c9d1d9", Selection: "#264f78", ANSI: []string{"#484f58", "#ff7b72", "#3fb950", "#d29922", "#58a6ff", "#bc8cff", "#39c5cf", "#b1bac4", "#6e7681", "#ffa198", "#56d364", "#e3b341", "#79c0ff", "#d2a8ff", "#56d4dd", "#f0f6fc"}})
}

func defaultLightDefinition() model.ThemeDefinition {
	return builtinDefinition("GitHub Light", model.ThemeModeLight, "builtin:github-light:v1", model.TerminalColorPayload{Background: "#ffffff", Foreground: "#24292f", Cursor: "#24292f", Selection: "#b6d7ff", ANSI: []string{"#24292f", "#cf222e", "#116329", "#4d2d00", "#0969da", "#8250df", "#1b7c83", "#6e7781", "#57606a", "#a40e26", "#1a7f37", "#633c01", "#218bff", "#a475f9", "#3192aa", "#8c959f"}})
}

func builtinDefinition(name string, mode model.ThemeMode, fingerprint string, payload model.TerminalColorPayload) model.ThemeDefinition {
	encoded, _ := json.Marshal(payload)
	return model.ThemeDefinition{Name: name, Mode: mode, SourceType: model.ThemeSourceBuiltin, SourceName: "MSSH", SourceLicense: "MIT", SourceVersion: "1", SourceFingerprint: fingerprint, ColorPayload: string(encoded), IsBuiltin: true}
}
