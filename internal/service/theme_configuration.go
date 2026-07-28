package service

import (
	"encoding/json"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type validatedThemeConfiguration struct {
	globalStyle model.TerminalGlobalStyle
	profiles    []model.ThemeProfile
	assignments model.ThemeAssignments
}

func validateStoredThemeConfiguration(db themeDatabase) error {
	if _, err := loadValidatedThemeAssignments(db); err != nil {
		return err
	}
	style, exists, err := store.LoadTerminalGlobalStyle(db)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("terminal global style is not initialized")
	}
	return validateTerminalGlobalStyle(style)
}

func loadValidatedThemeAssignments(db themeDatabase) (model.ThemeAssignments, error) {
	assignments, exists, err := store.LoadThemeAssignments(db)
	if err != nil {
		return model.ThemeAssignments{}, err
	}
	if !exists {
		return model.ThemeAssignments{}, fmt.Errorf("theme assignments are not initialized")
	}
	if err = validateThemeAssignments(db, assignments); err != nil {
		return model.ThemeAssignments{}, err
	}
	return assignments, nil
}

func prepareThemeConfiguration(db themeDatabase, input model.ThemeConfigurationInput) (validatedThemeConfiguration, error) {
	globalStyle := normalizeTerminalGlobalStyle(input.GlobalStyle.TerminalGlobalStyle())
	if err := validateTerminalGlobalStyle(globalStyle); err != nil {
		return validatedThemeConfiguration{}, fmt.Errorf("terminal global style: %w", err)
	}
	profiles, err := validatedThemeProfiles(input.Profiles)
	if err != nil {
		return validatedThemeConfiguration{}, err
	}
	assignments := input.Assignments.ThemeAssignments()
	if err = validateThemeAssignments(db, assignments); err != nil {
		return validatedThemeConfiguration{}, err
	}
	return validatedThemeConfiguration{globalStyle: globalStyle, profiles: profiles, assignments: assignments}, nil
}

func saveThemeConfiguration(db themeDatabase, configuration validatedThemeConfiguration) error {
	for _, profile := range configuration.profiles {
		if err := store.UpdateThemeProfile(db, profile); err != nil {
			return err
		}
	}
	if err := store.SaveTerminalGlobalStyleDB(db, configuration.globalStyle); err != nil {
		return err
	}
	return store.SaveThemeAssignmentsDB(db, configuration.assignments)
}

func validatedThemeProfiles(inputs []model.ThemeProfileInput) ([]model.ThemeProfile, error) {
	profiles := make([]model.ThemeProfile, 0, len(inputs))
	seen := make(map[int64]struct{}, len(inputs))
	for _, input := range inputs {
		profile := normalizeThemeProfile(input.ThemeProfile())
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

func normalizeThemeProfile(profile model.ThemeProfile) model.ThemeProfile {
	profile.FontFamily = normalizeTerminalFontFamily(profile.FontFamily)
	return profile
}

func validateThemeAssignments(db themeDatabase, assignments model.ThemeAssignments) error {
	type assignmentCheck struct {
		label string
		id    int64
	}
	checks := []assignmentCheck{{label: "dark", id: assignments.DarkProfileID}, {label: "light", id: assignments.LightProfileID}}
	if !assignments.FollowInterfaceMode && assignments.FixedProfileID < 1 {
		return fmt.Errorf("fixed theme profile is required when follow mode is disabled")
	}
	if assignments.FixedProfileID != 0 {
		checks = append(checks, assignmentCheck{label: "fixed", id: assignments.FixedProfileID})
	}
	for _, check := range checks {
		if check.id <= 0 {
			return fmt.Errorf("%s theme profile id is required", check.label)
		}
		if _, err := store.GetThemeProfile(db, check.id); err != nil {
			return fmt.Errorf("%s theme profile: %w", check.label, err)
		}
	}
	return nil
}

func validateThemeProfile(profile model.ThemeProfile) error {
	if profile.Name == "" || profile.ThemeID < 1 {
		return fmt.Errorf("theme profile name, definition, and font are required")
	}
	if err := validateTerminalStyle(profile.FontFamily, profile.FontSize, profile.CursorStyle); err != nil {
		return fmt.Errorf("theme profile %w", err)
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
