package service

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const maxTerminalFontFamilyRunes = 256

func defaultTerminalGlobalStyle() model.TerminalGlobalStyle {
	return model.TerminalGlobalStyle{
		FontFamily:  model.DefaultTerminalFontFamily,
		FontSize:    model.DefaultTerminalFontSize,
		CursorStyle: model.CursorStyleBar,
	}
}

func normalizeTerminalGlobalStyle(style model.TerminalGlobalStyle) model.TerminalGlobalStyle {
	style.FontFamily = normalizeTerminalFontFamily(style.FontFamily)
	return style
}

func normalizeTerminalFontFamily(fontFamily string) string {
	fontFamily = strings.Map(func(value rune) rune {
		if unicode.IsControl(value) {
			return -1
		}
		return value
	}, fontFamily)
	fontFamily = strings.TrimSpace(fontFamily)
	runes := []rune(fontFamily)
	if len(runes) > maxTerminalFontFamilyRunes {
		fontFamily = string(runes[:maxTerminalFontFamilyRunes])
	}
	return fontFamily
}

func validateTerminalStyle(fontFamily string, fontSize int, cursorStyle model.CursorStyle) error {
	if normalizeTerminalFontFamily(fontFamily) == "" {
		return fmt.Errorf("terminal font family is required")
	}
	if fontSize < 8 || fontSize > 48 {
		return fmt.Errorf("terminal font size must be between 8 and 48")
	}
	if cursorStyle != model.CursorStyleBar && cursorStyle != model.CursorStyleBlock && cursorStyle != model.CursorStyleUnderline {
		return fmt.Errorf("invalid terminal cursor style")
	}
	return nil
}

func validateTerminalGlobalStyle(style model.TerminalGlobalStyle) error {
	return validateTerminalStyle(style.FontFamily, style.FontSize, style.CursorStyle)
}

func initializeTerminalGlobalStyle(db themeDatabase) error {
	style, exists, err := store.LoadTerminalGlobalStyle(db)
	if err != nil {
		return err
	}
	if exists {
		if err = validateTerminalGlobalStyle(style); err != nil {
			return fmt.Errorf("terminal global style: %w", err)
		}
		return nil
	}
	if err = store.SaveTerminalGlobalStyleDB(db, defaultTerminalGlobalStyle()); err != nil {
		return fmt.Errorf("initialize terminal global style: %w", err)
	}
	return nil
}
