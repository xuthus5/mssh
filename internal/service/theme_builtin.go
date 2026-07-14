package service

import (
	"database/sql"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type builtinCatalogState struct {
	definitionsByFingerprint map[string]model.ThemeDefinition
	builtinDefinitionsByName map[string]model.ThemeDefinition
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
	state, err := loadBuiltinCatalogState(tx)
	if err != nil {
		return err
	}
	defaultProfiles := make(map[string]int64, 2)
	for _, definition := range builtinThemeDefinitions() {
		themeID, ensureErr := ensureBuiltinDefinition(tx, state, definition)
		if ensureErr != nil {
			return ensureErr
		}
		profileID, ensureErr := ensureBuiltinProfile(tx, state, definition.Name, themeID)
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
		builtinDefinitionsByName: make(map[string]model.ThemeDefinition),
		profileByThemeID:         make(map[int64]int64, len(profiles)),
		profileIDs:               make(map[int64]struct{}, len(profiles)),
	}
	for _, definition := range definitions {
		state.definitionsByFingerprint[definition.SourceFingerprint] = definition
		if definition.IsBuiltin {
			state.builtinDefinitionsByName[definition.Name] = definition
		}
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
	if existing, exists := state.builtinDefinitionsByName[definition.Name]; exists {
		definition.ID = existing.ID
		if err := store.UpdateThemeDefinition(tx, definition); err != nil {
			return 0, err
		}
		state.definitionsByFingerprint[definition.SourceFingerprint] = definition
		return definition.ID, nil
	}
	created, err := store.CreateThemeDefinition(tx, definition)
	if err != nil {
		return 0, err
	}
	state.definitionsByFingerprint[created.SourceFingerprint] = *created
	state.builtinDefinitionsByName[created.Name] = *created
	return created.ID, nil
}

func ensureBuiltinProfile(tx *sql.Tx, state *builtinCatalogState, name string, themeID int64) (int64, error) {
	if profileID, exists := state.profileByThemeID[themeID]; exists {
		return profileID, nil
	}
	created, err := store.CreateThemeProfile(tx, defaultBuiltinProfile(name, themeID))
	if err != nil {
		return 0, err
	}
	state.profileByThemeID[themeID] = created.ID
	state.profileIDs[created.ID] = struct{}{}
	return created.ID, nil
}

func defaultBuiltinProfile(name string, themeID int64) model.ThemeProfile {
	return model.ThemeProfile{Name: name, ThemeID: themeID, FontFamily: defaultTerminalFont, FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`}
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
	profile.FontFamily = defaultTerminalFont
	profile.FontSize = 14
	profile.CursorStyle = model.CursorStyleBar
	profile.ColorOverrides = `{}`
	if err = store.UpdateThemeProfile(tx, *profile); err != nil {
		return false, err
	}
	return true, nil
}
