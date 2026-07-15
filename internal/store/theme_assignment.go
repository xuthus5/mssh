package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"

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

var themeAssignmentKeys = []string{darkThemeProfileKey, lightThemeProfileKey, followThemeModeKey, fixedThemeProfileKey}

var themeAssignmentValueTypes = map[string]string{
	darkThemeProfileKey:  "number",
	lightThemeProfileKey: "number",
	followThemeModeKey:   "boolean",
	fixedThemeProfileKey: "number",
}

type themeAssignmentSetting struct {
	key, value, valueType string
}

func SaveThemeAssignments(db *sql.DB, assignments model.ThemeAssignments) error {
	return SaveThemeAssignmentsDB(db, assignments)
}

func SaveThemeAssignmentsDB(db themeDB, assignments model.ThemeAssignments) error {
	settings := []themeAssignmentSetting{
		{darkThemeProfileKey, strconv.FormatInt(assignments.DarkProfileID, 10), "number"},
		{lightThemeProfileKey, strconv.FormatInt(assignments.LightProfileID, 10), "number"},
		{followThemeModeKey, strconv.FormatBool(assignments.FollowInterfaceMode), "boolean"},
		{fixedThemeProfileKey, strconv.FormatInt(assignments.FixedProfileID, 10), "number"},
	}
	for _, setting := range settings {
		if err := saveThemeAssignment(db, setting); err != nil {
			return err
		}
	}
	return nil
}

func saveThemeAssignment(db themeDB, setting themeAssignmentSetting) error {
	_, err := db.Exec(`INSERT INTO settings (key, namespace, value, value_type, version, updated_at) VALUES (?, 'terminal', ?, ?, 1, datetime('now')) ON CONFLICT(key) DO UPDATE SET namespace=excluded.namespace, value=excluded.value, value_type=excluded.value_type, version=excluded.version, updated_at=excluded.updated_at`, setting.key, setting.value, setting.valueType)
	if err != nil {
		return fmt.Errorf("save theme assignment %s: %w", setting.key, err)
	}
	return nil
}

func LoadThemeAssignments(db themeDB) (model.ThemeAssignments, bool, error) {
	values, exists, err := loadThemeAssignmentValues(db)
	if err != nil || !exists {
		return model.ThemeAssignments{}, exists, err
	}
	assignments, err := parseThemeAssignments(values)
	if err != nil {
		return model.ThemeAssignments{}, false, err
	}
	return assignments, true, nil
}

func loadThemeAssignmentValues(db themeDB) (map[string]string, bool, error) {
	values := make(map[string]string, len(themeAssignmentKeys))
	for _, key := range themeAssignmentKeys {
		setting, exists, err := loadThemeAssignmentSetting(db, key)
		if err != nil {
			return nil, false, err
		}
		if !exists {
			continue
		}
		values[key] = setting.Value
	}
	if len(values) == 0 {
		return nil, false, nil
	}
	if len(values) != len(themeAssignmentKeys) {
		return nil, false, fmt.Errorf("theme assignments are incomplete")
	}
	return values, true, nil
}

func loadThemeAssignmentSetting(db themeDB, key string) (model.Setting, bool, error) {
	setting, err := scanSetting(db.QueryRow("SELECT key, namespace, value, value_type, version, updated_at FROM settings WHERE key = ?", key))
	if errors.Is(err, sql.ErrNoRows) {
		return model.Setting{}, false, nil
	}
	if err != nil {
		return model.Setting{}, false, fmt.Errorf("read theme assignment %s: parse theme assignment: %w", key, err)
	}
	if setting.Namespace != "terminal" {
		return model.Setting{}, false, fmt.Errorf("read theme assignment %s: invalid namespace", key)
	}
	if setting.ValueType != themeAssignmentValueTypes[key] {
		return model.Setting{}, false, fmt.Errorf("read theme assignment %s: invalid value type", key)
	}
	return setting, true, nil
}

func parseThemeAssignments(values map[string]string) (model.ThemeAssignments, error) {
	darkProfileID, err := parseThemeAssignmentID(values, darkThemeProfileKey)
	if err != nil {
		return model.ThemeAssignments{}, err
	}
	lightProfileID, err := parseThemeAssignmentID(values, lightThemeProfileKey)
	if err != nil {
		return model.ThemeAssignments{}, err
	}
	fixedProfileID, err := parseThemeAssignmentID(values, fixedThemeProfileKey)
	if err != nil {
		return model.ThemeAssignments{}, err
	}
	followInterfaceMode, err := parseThemeAssignmentBool(values, followThemeModeKey)
	if err != nil {
		return model.ThemeAssignments{}, err
	}
	return model.ThemeAssignments{DarkProfileID: darkProfileID, LightProfileID: lightProfileID, FollowInterfaceMode: followInterfaceMode, FixedProfileID: fixedProfileID}, nil
}

func parseThemeAssignmentID(values map[string]string, key string) (int64, error) {
	id, err := strconv.ParseInt(values[key], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse theme assignment %s: %w", key, err)
	}
	return id, nil
}

func parseThemeAssignmentBool(values map[string]string, key string) (bool, error) {
	value, err := strconv.ParseBool(values[key])
	if err != nil {
		return false, fmt.Errorf("parse theme assignment %s: %w", key, err)
	}
	return value, nil
}

func GetThemeAssignments(db themeDB) (model.ThemeAssignments, error) {
	assignments, exists, err := LoadThemeAssignments(db)
	if err != nil {
		return model.ThemeAssignments{}, err
	}
	if !exists {
		return model.ThemeAssignments{}, fmt.Errorf("theme assignments are not initialized")
	}
	return assignments, nil
}
