package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	terminalFontFamilyKey  = "terminal.style.font_family"
	terminalFontSizeKey    = "terminal.style.font_size"
	terminalCursorStyleKey = "terminal.style.cursor_style"
)

var terminalGlobalStyleKeys = []string{terminalFontFamilyKey, terminalFontSizeKey, terminalCursorStyleKey}

var terminalGlobalStyleValueTypes = map[string]string{
	terminalFontFamilyKey:  "string",
	terminalFontSizeKey:    "number",
	terminalCursorStyleKey: "string",
}

func LoadTerminalGlobalStyle(db themeDB) (model.TerminalGlobalStyle, bool, error) {
	values, exists, err := loadTerminalGlobalStyleValues(db)
	if err != nil || !exists {
		return model.TerminalGlobalStyle{}, exists, err
	}
	style, err := parseTerminalGlobalStyle(values)
	if err != nil {
		return model.TerminalGlobalStyle{}, true, err
	}
	return style, true, nil
}

func GetTerminalGlobalStyle(db themeDB) (model.TerminalGlobalStyle, error) {
	style, exists, err := LoadTerminalGlobalStyle(db)
	if err != nil {
		return model.TerminalGlobalStyle{}, err
	}
	if !exists {
		return model.TerminalGlobalStyle{}, fmt.Errorf("terminal global style is not initialized")
	}
	return style, nil
}

func loadTerminalGlobalStyleValues(db themeDB) (map[string]string, bool, error) {
	values := make(map[string]string, len(terminalGlobalStyleKeys))
	exists := false
	for _, key := range terminalGlobalStyleKeys {
		setting, settingExists, err := loadTerminalGlobalStyleSetting(db, key)
		if err != nil {
			return nil, exists || settingExists, err
		}
		if settingExists {
			exists = true
			values[key] = setting.Value
		}
	}
	if len(values) == 0 {
		return nil, false, nil
	}
	if len(values) != len(terminalGlobalStyleKeys) {
		return nil, true, fmt.Errorf("terminal global style is incomplete")
	}
	return values, true, nil
}

func loadTerminalGlobalStyleSetting(db themeDB, key string) (model.Setting, bool, error) {
	var setting model.Setting
	var updatedAt string
	err := db.QueryRow("SELECT key, namespace, value, value_type, version, updated_at FROM settings WHERE key = ?", key).Scan(
		&setting.Key, &setting.Namespace, &setting.Value, &setting.ValueType, &setting.Version, &updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Setting{}, false, nil
	}
	if err != nil {
		return model.Setting{}, false, fmt.Errorf("read terminal global style %s: %w", key, err)
	}
	setting.UpdatedAt, err = time.Parse("2006-01-02 15:04:05", updatedAt)
	if err == nil {
		err = validateSetting(setting)
	}
	if err != nil {
		return model.Setting{}, true, fmt.Errorf("read terminal global style %s: %w", key, err)
	}
	if setting.Namespace != "terminal" {
		return model.Setting{}, true, fmt.Errorf("read terminal global style %s: invalid namespace", key)
	}
	if setting.ValueType != terminalGlobalStyleValueTypes[key] {
		return model.Setting{}, true, fmt.Errorf("read terminal global style %s: invalid value type", key)
	}
	return setting, true, nil
}

func parseTerminalGlobalStyle(values map[string]string) (model.TerminalGlobalStyle, error) {
	var style model.TerminalGlobalStyle
	targets := map[string]any{
		terminalFontFamilyKey:  &style.FontFamily,
		terminalFontSizeKey:    &style.FontSize,
		terminalCursorStyleKey: &style.CursorStyle,
	}
	for _, key := range terminalGlobalStyleKeys {
		if err := json.Unmarshal([]byte(values[key]), targets[key]); err != nil {
			return model.TerminalGlobalStyle{}, fmt.Errorf("parse terminal global style %s: %w", key, err)
		}
	}
	return style, nil
}

func SaveTerminalGlobalStyleDB(db themeDB, style model.TerminalGlobalStyle) error {
	settings := []struct {
		key       string
		value     any
		valueType string
	}{
		{key: terminalFontFamilyKey, value: style.FontFamily, valueType: "string"},
		{key: terminalFontSizeKey, value: style.FontSize, valueType: "number"},
		{key: terminalCursorStyleKey, value: style.CursorStyle, valueType: "string"},
	}
	for _, setting := range settings {
		value, err := json.Marshal(setting.value)
		if err != nil {
			return fmt.Errorf("encode terminal global style %s: %w", setting.key, err)
		}
		_, err = db.Exec(`INSERT INTO settings (key, namespace, value, value_type, version, updated_at) VALUES (?, 'terminal', ?, ?, 1, datetime('now')) ON CONFLICT(key) DO UPDATE SET namespace=excluded.namespace, value=excluded.value, value_type=excluded.value_type, version=1, updated_at=datetime('now')`, setting.key, string(value), setting.valueType)
		if err != nil {
			return fmt.Errorf("save terminal global style %s: %w", setting.key, err)
		}
	}
	return nil
}
