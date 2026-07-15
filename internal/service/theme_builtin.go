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
	if err := initializeTerminalGlobalStyle(tx); err != nil {
		return err
	}
	// 内置 catalog 不兼容变更必须提升 databaseFormatVersion 并触发破坏性重建。
	definitions := builtinThemeDefinitions()
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
	return initializeThemeAssignments(tx, defaultProfiles)
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
	}
	for _, definition := range definitions {
		state.definitionsByFingerprint[definition.SourceFingerprint] = definition
	}
	for _, profile := range profiles {
		if _, exists := state.profileByThemeID[profile.ThemeID]; !exists {
			state.profileByThemeID[profile.ThemeID] = profile.ID
		}
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
	return created.ID, nil
}

func defaultBuiltinProfile(name string, themeID int64) model.ThemeProfile {
	return model.ThemeProfile{Name: name, ThemeID: themeID, FollowGlobalStyle: true, FontFamily: defaultTerminalFont, FontSize: model.DefaultTerminalFontSize, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`}
}

func initializeThemeAssignments(tx *sql.Tx, defaults map[string]int64) error {
	assignments, exists, err := store.LoadThemeAssignments(tx)
	if err != nil {
		return err
	}
	if exists {
		return validateThemeAssignments(tx, assignments)
	}
	darkProfileID, darkFound := defaults["GitHub Dark"]
	lightProfileID, lightFound := defaults["GitHub Light"]
	if !darkFound || !lightFound || darkProfileID < 1 || lightProfileID < 1 {
		return fmt.Errorf("default GitHub theme profiles are missing")
	}
	assignments = model.ThemeAssignments{DarkProfileID: darkProfileID, LightProfileID: lightProfileID, FollowInterfaceMode: true}
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
