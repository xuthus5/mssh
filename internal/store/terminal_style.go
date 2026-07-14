package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	terminalFontFamilyKey  = "terminal.style.font_family"
	terminalFontSizeKey    = "terminal.style.font_size"
	terminalCursorStyleKey = "terminal.style.cursor_style"
)

func GetTerminalGlobalStyle(db themeDB) (model.TerminalGlobalStyle, error) {
	style := model.TerminalGlobalStyle{
		FontFamily:  model.DefaultTerminalFontFamily,
		FontSize:    model.DefaultTerminalFontSize,
		CursorStyle: model.CursorStyleBar,
	}
	values := []struct {
		key    string
		target any
	}{
		{key: terminalFontFamilyKey, target: &style.FontFamily},
		{key: terminalFontSizeKey, target: &style.FontSize},
		{key: terminalCursorStyleKey, target: &style.CursorStyle},
	}
	for _, value := range values {
		var raw string
		err := db.QueryRow("SELECT value FROM settings WHERE key = ?", value.key).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return model.TerminalGlobalStyle{}, fmt.Errorf("read terminal global style %s: %w", value.key, err)
		}
		if err = json.Unmarshal([]byte(raw), value.target); err != nil {
			return model.TerminalGlobalStyle{}, fmt.Errorf("parse terminal global style %s: %w", value.key, err)
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
