package service

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func mustThemeProfiles(t *testing.T, themeService *ThemeService) []model.ThemeProfile {
	t.Helper()
	profiles, err := themeService.ListProfiles("")
	require.NoError(t, err)
	return profiles
}

func mustThemeProfileNamed(t *testing.T, profiles []model.ThemeProfile, name string) model.ThemeProfile {
	t.Helper()
	for _, profile := range profiles {
		if profile.Name == name {
			return profile
		}
	}
	t.Fatalf("theme profile %q not found", name)
	return model.ThemeProfile{}
}

type themeProfileStyle struct {
	font      string
	size      int
	overrides string
}

func customizeThemeProfile(profile model.ThemeProfile, style themeProfileStyle) model.ThemeProfile {
	profile.FontFamily = style.font
	profile.FontSize = style.size
	profile.CursorStyle = model.CursorStyleUnderline
	profile.ColorOverrides = style.overrides
	return profile
}

func themeProfileID(id int64) string {
	return fmt.Sprintf("%d", id)
}

func mustBuiltinDefinitionNamed(t *testing.T, name string) model.ThemeDefinition {
	t.Helper()
	for _, definition := range builtinThemeDefinitions() {
		if definition.Name == name {
			return definition
		}
	}
	t.Fatalf("built-in theme definition %q not found", name)
	return model.ThemeDefinition{}
}
