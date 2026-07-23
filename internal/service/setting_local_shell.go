package service

import (
	"fmt"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	terminalLocalShellKey     = "terminal.local_shell"
	terminalLocalShellArgsKey = "terminal.local_shell_args"
	terminalLocalShellCWDKey  = "terminal.local_shell_cwd"
	maxLocalShellPathRunes    = 512
	maxLocalShellArgsBytes    = 2048
	maxLocalShellCWDRunes     = 1024
)

func validateLocalShellSettings(entries []model.Setting) error {
	for _, entry := range entries {
		if err := validateLocalShellSettingEntry(entry); err != nil {
			return err
		}
	}
	return nil
}

func validateLocalShellSettingEntry(entry model.Setting) error {
	switch entry.Key {
	case terminalLocalShellKey:
		return validateDecodedLocalShellString(entry.Value, validateLocalShellPathSetting)
	case terminalLocalShellArgsKey:
		return validateDecodedLocalShellString(entry.Value, validateLocalShellArgsSetting)
	case terminalLocalShellCWDKey:
		return validateDecodedLocalShellString(entry.Value, validateLocalShellCWDSetting)
	default:
		return nil
	}
}

func validateDecodedLocalShellString(raw string, validate func(string) error) error {
	value, err := decodeSettingString(raw)
	if err != nil {
		return err
	}
	return validate(value)
}

func validateLocalShellPathSetting(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if strings.ContainsRune(value, 0) {
		return fmt.Errorf("local shell path contains NUL")
	}
	if utf8.RuneCountInString(value) > maxLocalShellPathRunes {
		return fmt.Errorf("local shell path must not exceed %d characters", maxLocalShellPathRunes)
	}
	// Reject relative traversal markers even when absolute path validation happens at open time.
	if strings.Contains(value, ".."+string(filepath.Separator)) || strings.HasSuffix(value, "..") {
		return fmt.Errorf("local shell path must not contain parent traversal")
	}
	return nil
}

func validateLocalShellArgsSetting(value string) error {
	if strings.ContainsRune(value, 0) {
		return fmt.Errorf("local shell args contain NUL")
	}
	if len(value) > maxLocalShellArgsBytes {
		return fmt.Errorf("local shell args must not exceed %d bytes", maxLocalShellArgsBytes)
	}
	return nil
}

func validateLocalShellCWDSetting(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if strings.ContainsRune(value, 0) {
		return fmt.Errorf("local shell working directory contains NUL")
	}
	if utf8.RuneCountInString(value) > maxLocalShellCWDRunes {
		return fmt.Errorf("local shell working directory must not exceed %d characters", maxLocalShellCWDRunes)
	}
	return nil
}
