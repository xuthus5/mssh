package service

import (
	"database/sql"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type builtinCatalogState struct {
	definitionsByFingerprint map[string]model.ThemeDefinition
	profileByThemeID         map[int64]int64
	profileIDs               map[int64]struct{}
}

func (service *ThemeService) InitializeDefaults() error {
	tx, err := service.db.Begin()
	if err != nil {
		return fmt.Errorf("begin initialize terminal themes: %w", err)
	}
	if err = initializeBuiltinCatalog(tx); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("initialize terminal themes: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit initialize terminal themes: %w", err)
	}
	return nil
}

func initializeBuiltinCatalog(tx *sql.Tx) error {
	if err := repairTerminalGlobalStyle(tx); err != nil {
		return err
	}
	definitions := builtinThemeDefinitions()
	if err := replaceStaleBuiltinCatalog(tx, definitions); err != nil {
		return err
	}
	state, err := loadBuiltinCatalogState(tx)
	if err != nil {
		return err
	}
	defaultProfiles := make(map[string]int64, 2)
	for _, definition := range definitions {
		themeID, ensureErr := ensureBuiltinDefinition(tx, state, definition)
		if ensureErr != nil {
			return ensureErr
		}
		profileID, ensureErr := ensureBuiltinProfile(builtinProfileOptions{
			tx: tx, state: state, name: definition.Name, themeID: themeID,
		})
		if ensureErr != nil {
			return ensureErr
		}
		defaultProfiles[definition.Name] = profileID
	}
	return repairThemeAssignments(tx, state, defaultProfiles)
}

func loadBuiltinCatalogState(tx *sql.Tx) (*builtinCatalogState, error) {
	definitions, err := store.ListThemeDefinitions(tx, "")
	if err != nil {
		return nil, err
	}
	profiles, err := store.ListThemeProfiles(tx, "")
	if err != nil {
		return nil, err
	}
	state := &builtinCatalogState{
		definitionsByFingerprint: make(map[string]model.ThemeDefinition, len(definitions)),
		profileByThemeID:         make(map[int64]int64, len(profiles)),
		profileIDs:               make(map[int64]struct{}, len(profiles)),
	}
	for _, definition := range definitions {
		state.definitionsByFingerprint[definition.SourceFingerprint] = definition
	}
	for _, profile := range profiles {
		if _, exists := state.profileByThemeID[profile.ThemeID]; !exists {
			state.profileByThemeID[profile.ThemeID] = profile.ID
		}
		state.profileIDs[profile.ID] = struct{}{}
	}
	return state, nil
}

func ensureBuiltinDefinition(tx *sql.Tx, state *builtinCatalogState, definition model.ThemeDefinition) (int64, error) {
	if existing, exists := state.definitionsByFingerprint[definition.SourceFingerprint]; exists {
		return existing.ID, nil
	}
	created, err := store.CreateThemeDefinition(tx, definition)
	if err != nil {
		return 0, err
	}
	state.definitionsByFingerprint[created.SourceFingerprint] = *created
	return created.ID, nil
}

func replaceStaleBuiltinCatalog(tx *sql.Tx, expected []model.ThemeDefinition) error {
	expectedByFingerprint := make(map[string]model.ThemeDefinition, len(expected))
	for _, definition := range expected {
		expectedByFingerprint[definition.SourceFingerprint] = definition
	}
	existing, err := store.ListThemeDefinitions(tx, "")
	if err != nil {
		return err
	}
	for _, definition := range existing {
		expectedDefinition, found := expectedByFingerprint[definition.SourceFingerprint]
		if !definition.IsBuiltin || found && builtinDefinitionMatches(definition, expectedDefinition) {
			continue
		}
		if _, err = tx.Exec("DELETE FROM terminal_theme_profiles WHERE theme_id = ?", definition.ID); err == nil {
			_, err = tx.Exec("DELETE FROM themes WHERE id = ?", definition.ID)
		}
		if err != nil {
			return fmt.Errorf("replace stale built-in theme %q: %w", definition.Name, err)
		}
	}
	return nil
}

func builtinDefinitionMatches(actual, expected model.ThemeDefinition) bool {
	return actual.Name == expected.Name && actual.Mode == expected.Mode && actual.SourceType == expected.SourceType &&
		actual.SourceName == expected.SourceName && actual.SourceURL == expected.SourceURL && actual.SourceAuthor == expected.SourceAuthor &&
		actual.SourceLicense == expected.SourceLicense && actual.SourceVersion == expected.SourceVersion &&
		actual.SourceFingerprint == expected.SourceFingerprint && actual.ColorPayload == expected.ColorPayload &&
		actual.RawPayload == expected.RawPayload && actual.IsBuiltin == expected.IsBuiltin
}

type builtinProfileOptions struct {
	tx      *sql.Tx
	state   *builtinCatalogState
	name    string
	themeID int64
}

func ensureBuiltinProfile(options builtinProfileOptions) (int64, error) {
	tx, state := options.tx, options.state
	if profileID, exists := state.profileByThemeID[options.themeID]; exists {
		return profileID, nil
	}
	created, err := store.CreateThemeProfile(tx, defaultBuiltinProfile(options.name, options.themeID))
	if err != nil {
		return 0, err
	}
	state.profileByThemeID[options.themeID] = created.ID
	state.profileIDs[created.ID] = struct{}{}
	return created.ID, nil
}

func defaultBuiltinProfile(name string, themeID int64) model.ThemeProfile {
	return model.ThemeProfile{Name: name, ThemeID: themeID, FollowGlobalStyle: true, FontFamily: defaultTerminalFont, FontSize: model.DefaultTerminalFontSize, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`}
}

func repairThemeAssignments(tx *sql.Tx, state *builtinCatalogState, defaults map[string]int64) error {
	assignments, err := store.GetThemeAssignments(tx)
	if err != nil {
		return err
	}
	if _, valid := state.profileIDs[assignments.DarkProfileID]; !valid {
		assignments.DarkProfileID = defaults["GitHub Dark"]
	}
	if _, valid := state.profileIDs[assignments.LightProfileID]; !valid {
		assignments.LightProfileID = defaults["GitHub Light"]
	}
	if assignments.DarkProfileID == 0 || assignments.LightProfileID == 0 {
		return fmt.Errorf("default GitHub theme profiles are missing")
	}
	if _, valid := state.profileIDs[assignments.FixedProfileID]; !valid {
		if assignments.FollowInterfaceMode {
			assignments.FixedProfileID = 0
		} else {
			assignments.FixedProfileID = assignments.DarkProfileID
		}
	}
	return store.SaveThemeAssignmentsDB(tx, assignments)
}

func (service *ThemeService) ResetBuiltinStyles() (model.BuiltinThemeResetResult, error) {
	if err := service.InitializeDefaults(); err != nil {
		return model.BuiltinThemeResetResult{}, fmt.Errorf("prepare built-in theme reset: %w", err)
	}
	tx, err := service.db.Begin()
	if err != nil {
		return model.BuiltinThemeResetResult{}, fmt.Errorf("begin reset built-in theme styles: %w", err)
	}
	result, err := resetAssignedBuiltinStyles(tx)
	if err != nil {
		_ = tx.Rollback()
		return model.BuiltinThemeResetResult{}, fmt.Errorf("reset built-in theme styles: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return model.BuiltinThemeResetResult{}, fmt.Errorf("commit reset built-in theme styles: %w", err)
	}
	return result, nil
}

func resetAssignedBuiltinStyles(tx *sql.Tx) (model.BuiltinThemeResetResult, error) {
	assignments, err := store.GetThemeAssignments(tx)
	if err != nil {
		return model.BuiltinThemeResetResult{}, err
	}
	resetByID := make(map[int64]bool, 3)
	darkReset, err := resetBuiltinProfileCached(tx, assignments.DarkProfileID, resetByID)
	if err != nil {
		return model.BuiltinThemeResetResult{}, err
	}
	lightReset, err := resetBuiltinProfileCached(tx, assignments.LightProfileID, resetByID)
	if err != nil {
		return model.BuiltinThemeResetResult{}, err
	}
	fixedReset := false
	if !assignments.FollowInterfaceMode {
		fixedReset, err = resetBuiltinProfileCached(tx, assignments.FixedProfileID, resetByID)
		if err != nil {
			return model.BuiltinThemeResetResult{}, err
		}
	}
	return model.BuiltinThemeResetResult{DarkReset: darkReset, LightReset: lightReset, FixedReset: fixedReset}, nil
}

func resetBuiltinProfileCached(tx *sql.Tx, profileID int64, resetByID map[int64]bool) (bool, error) {
	if reset, exists := resetByID[profileID]; exists {
		return reset, nil
	}
	reset, err := resetBuiltinProfile(tx, profileID)
	if err != nil {
		return false, err
	}
	resetByID[profileID] = reset
	return reset, nil
}

func resetBuiltinProfile(tx *sql.Tx, profileID int64) (bool, error) {
	profile, err := store.GetThemeProfile(tx, profileID)
	if err != nil {
		return false, err
	}
	if profile.Definition == nil || !profile.Definition.IsBuiltin {
		return false, nil
	}
	profile.FollowGlobalStyle = true
	profile.FontFamily = defaultTerminalFont
	profile.FontSize = model.DefaultTerminalFontSize
	profile.CursorStyle = model.CursorStyleBar
	profile.ColorOverrides = `{}`
	if err = store.UpdateThemeProfile(tx, *profile); err != nil {
		return false, err
	}
	return true, nil
}
