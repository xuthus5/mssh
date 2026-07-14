package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

type themeDB interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

const (
	darkThemeProfileKey  = "terminal.theme.dark_profile_id"
	lightThemeProfileKey = "terminal.theme.light_profile_id"
	followThemeModeKey   = "terminal.theme.follow_interface_mode"
	fixedThemeProfileKey = "terminal.theme.fixed_profile_id"
)

func CreateThemeDefinition(db themeDB, definition model.ThemeDefinition) (*model.ThemeDefinition, error) {
	result, err := db.Exec(`INSERT INTO themes (name, mode, source_type, source_name, source_url, source_author, source_license, source_version, source_fingerprint, color_payload, raw_payload, is_builtin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, definition.Name, definition.Mode, definition.SourceType, definition.SourceName, definition.SourceURL, definition.SourceAuthor, definition.SourceLicense, definition.SourceVersion, definition.SourceFingerprint, definition.ColorPayload, definition.RawPayload, definition.IsBuiltin)
	if err != nil {
		return nil, fmt.Errorf("create theme definition: %w", err)
	}
	definition.ID, err = result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create theme definition id: %w", err)
	}
	return GetThemeDefinition(db, definition.ID)
}

func ListThemeDefinitions(db themeDB, mode model.ThemeMode) ([]model.ThemeDefinition, error) {
	query := `SELECT id, name, mode, source_type, source_name, source_url, source_author, source_license, source_version, source_fingerprint, color_payload, raw_payload, is_builtin, created_at, updated_at FROM themes`
	args := []any{}
	if mode != "" {
		query += " WHERE mode = ? OR mode = 'universal'"
		args = append(args, mode)
	}
	query += " ORDER BY is_builtin DESC, name"
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list theme definitions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	definitions := make([]model.ThemeDefinition, 0)
	for rows.Next() {
		definition, scanErr := scanThemeDefinition(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		definitions = append(definitions, definition)
	}
	return definitions, rows.Err()
}

func GetThemeDefinition(db themeDB, id int64) (*model.ThemeDefinition, error) {
	row := db.QueryRow(`SELECT id, name, mode, source_type, source_name, source_url, source_author, source_license, source_version, source_fingerprint, color_payload, raw_payload, is_builtin, created_at, updated_at FROM themes WHERE id = ?`, id)
	definition, err := scanThemeDefinition(row)
	if err != nil {
		return nil, fmt.Errorf("get theme definition: %w", err)
	}
	return &definition, nil
}

func UpdateThemeDefinition(db themeDB, definition model.ThemeDefinition) error {
	result, err := db.Exec(`UPDATE themes SET name = ?, mode = ?, source_type = ?, source_name = ?, source_url = ?, source_author = ?, source_license = ?, source_version = ?, source_fingerprint = ?, color_payload = ?, raw_payload = ?, is_builtin = ?, updated_at = datetime('now') WHERE id = ?`, definition.Name, definition.Mode, definition.SourceType, definition.SourceName, definition.SourceURL, definition.SourceAuthor, definition.SourceLicense, definition.SourceVersion, definition.SourceFingerprint, definition.ColorPayload, definition.RawPayload, definition.IsBuiltin, definition.ID)
	if err != nil {
		return fmt.Errorf("update theme definition: %w", err)
	}
	return requireAffected(result, "theme definition")
}

func DeleteThemeDefinition(db themeDB, id int64) error {
	definition, err := GetThemeDefinition(db, id)
	if err != nil {
		return err
	}
	if definition.IsBuiltin {
		return fmt.Errorf("built-in theme definitions cannot be deleted")
	}
	var references int
	if err = db.QueryRow("SELECT COUNT(*) FROM terminal_theme_profiles WHERE theme_id = ?", id).Scan(&references); err != nil {
		return fmt.Errorf("count theme profile references: %w", err)
	}
	if references > 0 {
		return fmt.Errorf("theme definition is referenced by %d profiles", references)
	}
	if _, err = db.Exec("DELETE FROM themes WHERE id = ?", id); err != nil {
		return fmt.Errorf("delete theme definition: %w", err)
	}
	return nil
}

func CreateThemeProfile(db themeDB, profile model.ThemeProfile) (*model.ThemeProfile, error) {
	result, err := db.Exec(`INSERT INTO terminal_theme_profiles (name, theme_id, follow_global_style, font_family, font_size, cursor_style, color_overrides) VALUES (?, ?, ?, ?, ?, ?, ?)`, profile.Name, profile.ThemeID, profile.FollowGlobalStyle, profile.FontFamily, profile.FontSize, profile.CursorStyle, profile.ColorOverrides)
	if err != nil {
		return nil, fmt.Errorf("create theme profile: %w", err)
	}
	profile.ID, err = result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create theme profile id: %w", err)
	}
	return GetThemeProfile(db, profile.ID)
}

func ListThemeProfiles(db themeDB, mode model.ThemeMode) ([]model.ThemeProfile, error) {
	query := themeProfileSelect
	args := []any{}
	if mode != "" {
		query += " WHERE themes.mode = ? OR themes.mode = 'universal'"
		args = append(args, mode)
	}
	query += " ORDER BY terminal_theme_profiles.name"
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list theme profiles: %w", err)
	}
	defer func() { _ = rows.Close() }()
	profiles := make([]model.ThemeProfile, 0)
	for rows.Next() {
		profile, scanErr := scanThemeProfile(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		profiles = append(profiles, profile)
	}
	return profiles, rows.Err()
}

const themeProfileSelect = `SELECT terminal_theme_profiles.id, terminal_theme_profiles.name, terminal_theme_profiles.theme_id, terminal_theme_profiles.follow_global_style, terminal_theme_profiles.font_family, terminal_theme_profiles.font_size, terminal_theme_profiles.cursor_style, terminal_theme_profiles.color_overrides, terminal_theme_profiles.created_at, terminal_theme_profiles.updated_at, themes.id, themes.name, themes.mode, themes.source_type, themes.source_name, themes.source_url, themes.source_author, themes.source_license, themes.source_version, themes.source_fingerprint, themes.color_payload, themes.raw_payload, themes.is_builtin, themes.created_at, themes.updated_at FROM terminal_theme_profiles JOIN themes ON themes.id = terminal_theme_profiles.theme_id`

func GetThemeProfile(db themeDB, id int64) (*model.ThemeProfile, error) {
	row := db.QueryRow(themeProfileSelect+" WHERE terminal_theme_profiles.id = ?", id)
	profile, err := scanThemeProfile(row)
	if err != nil {
		return nil, fmt.Errorf("get theme profile: %w", err)
	}
	return &profile, nil
}

func UpdateThemeProfile(db themeDB, profile model.ThemeProfile) error {
	result, err := db.Exec(`UPDATE terminal_theme_profiles SET name = ?, theme_id = ?, follow_global_style = ?, font_family = ?, font_size = ?, cursor_style = ?, color_overrides = ?, updated_at = datetime('now') WHERE id = ?`, profile.Name, profile.ThemeID, profile.FollowGlobalStyle, profile.FontFamily, profile.FontSize, profile.CursorStyle, profile.ColorOverrides, profile.ID)
	if err != nil {
		return fmt.Errorf("update theme profile: %w", err)
	}
	return requireAffected(result, "theme profile")
}

func DeleteThemeProfile(db themeDB, id int64) error {
	assignments, err := GetThemeAssignments(db)
	if err != nil {
		return err
	}
	if assignments.DarkProfileID == id || assignments.LightProfileID == id {
		return fmt.Errorf("assigned Dark or Light theme profiles cannot be deleted")
	}
	if assignments.FixedProfileID == id {
		if !assignments.FollowInterfaceMode {
			return fmt.Errorf("the active fixed theme profile cannot be deleted")
		}
		assignments.FixedProfileID = 0
		if err = SaveThemeAssignmentsDB(db, assignments); err != nil {
			return fmt.Errorf("clear historical fixed theme profile: %w", err)
		}
	}
	result, err := db.Exec("DELETE FROM terminal_theme_profiles WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete theme profile: %w", err)
	}
	return requireAffected(result, "theme profile")
}

func SaveThemeAssignments(db *sql.DB, assignments model.ThemeAssignments) error {
	return SaveThemeAssignmentsDB(db, assignments)
}

func SaveThemeAssignmentsDB(db themeDB, assignments model.ThemeAssignments) error {
	settings := []struct {
		key       string
		value     string
		valueType string
	}{
		{key: darkThemeProfileKey, value: strconv.FormatInt(assignments.DarkProfileID, 10), valueType: "number"},
		{key: lightThemeProfileKey, value: strconv.FormatInt(assignments.LightProfileID, 10), valueType: "number"},
		{key: followThemeModeKey, value: strconv.FormatBool(assignments.FollowInterfaceMode), valueType: "boolean"},
		{key: fixedThemeProfileKey, value: strconv.FormatInt(assignments.FixedProfileID, 10), valueType: "number"},
	}
	for _, setting := range settings {
		if err := saveThemeAssignment(db, setting.key, setting.value, setting.valueType); err != nil {
			return err
		}
	}
	return nil
}

func saveThemeAssignment(db themeDB, key, value, valueType string) error {
	_, err := db.Exec(`INSERT INTO settings (key, namespace, value, value_type, version, updated_at) VALUES (?, 'terminal', ?, ?, 1, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, value_type=excluded.value_type, version=1, updated_at=datetime('now')`, key, value, valueType)
	if err != nil {
		return fmt.Errorf("save theme assignment %s: %w", key, err)
	}
	return nil
}

func GetThemeAssignments(db themeDB) (model.ThemeAssignments, error) {
	darkProfileID, err := themeAssignmentID(db, darkThemeProfileKey)
	if err != nil {
		return model.ThemeAssignments{}, err
	}
	lightProfileID, err := themeAssignmentID(db, lightThemeProfileKey)
	if err != nil {
		return model.ThemeAssignments{}, err
	}
	followInterfaceMode, err := themeAssignmentBool(db, followThemeModeKey, true)
	if err != nil {
		return model.ThemeAssignments{}, err
	}
	fixedProfileID, err := themeAssignmentID(db, fixedThemeProfileKey)
	if err != nil {
		return model.ThemeAssignments{}, err
	}
	return model.ThemeAssignments{DarkProfileID: darkProfileID, LightProfileID: lightProfileID, FollowInterfaceMode: followInterfaceMode, FixedProfileID: fixedProfileID}, nil
}

func themeAssignmentID(db themeDB, key string) (int64, error) {
	var value string
	if err := db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, fmt.Errorf("read theme assignment %s: %w", key, err)
	}
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse theme assignment %s: %w", key, err)
	}
	return id, nil
}

func themeAssignmentBool(db themeDB, key string, defaultValue bool) (bool, error) {
	var value string
	if err := db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return defaultValue, nil
		}
		return false, fmt.Errorf("read theme assignment %s: %w", key, err)
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("parse theme assignment %s: %w", key, err)
	}
	return parsed, nil
}

type scanner interface{ Scan(dest ...any) error }

func scanThemeDefinition(row scanner) (model.ThemeDefinition, error) {
	var definition model.ThemeDefinition
	var createdAt, updatedAt string
	err := row.Scan(&definition.ID, &definition.Name, &definition.Mode, &definition.SourceType, &definition.SourceName, &definition.SourceURL, &definition.SourceAuthor, &definition.SourceLicense, &definition.SourceVersion, &definition.SourceFingerprint, &definition.ColorPayload, &definition.RawPayload, &definition.IsBuiltin, &createdAt, &updatedAt)
	if err != nil {
		return definition, err
	}
	definition.CreatedAt, err = time.Parse("2006-01-02 15:04:05", createdAt)
	if err == nil {
		definition.UpdatedAt, err = time.Parse("2006-01-02 15:04:05", updatedAt)
	}
	return definition, err
}

func scanThemeProfile(row scanner) (model.ThemeProfile, error) {
	var profile model.ThemeProfile
	var definition model.ThemeDefinition
	var profileCreated, profileUpdated, definitionCreated, definitionUpdated string
	err := row.Scan(&profile.ID, &profile.Name, &profile.ThemeID, &profile.FollowGlobalStyle, &profile.FontFamily, &profile.FontSize, &profile.CursorStyle, &profile.ColorOverrides, &profileCreated, &profileUpdated, &definition.ID, &definition.Name, &definition.Mode, &definition.SourceType, &definition.SourceName, &definition.SourceURL, &definition.SourceAuthor, &definition.SourceLicense, &definition.SourceVersion, &definition.SourceFingerprint, &definition.ColorPayload, &definition.RawPayload, &definition.IsBuiltin, &definitionCreated, &definitionUpdated)
	if err != nil {
		return profile, err
	}
	profile.CreatedAt, err = time.Parse("2006-01-02 15:04:05", profileCreated)
	if err == nil {
		profile.UpdatedAt, err = time.Parse("2006-01-02 15:04:05", profileUpdated)
	}
	if err == nil {
		definition.CreatedAt, err = time.Parse("2006-01-02 15:04:05", definitionCreated)
	}
	if err == nil {
		definition.UpdatedAt, err = time.Parse("2006-01-02 15:04:05", definitionUpdated)
	}
	profile.Definition = &definition
	return profile, err
}

func requireAffected(result sql.Result, entity string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check %s update: %w", entity, err)
	}
	if affected == 0 {
		return fmt.Errorf("%s not found", entity)
	}
	return nil
}
