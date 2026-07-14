package service

import (
	"encoding/json"
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/themeimport"
)

const expectedBuiltinThemeVersion = "c3968b385e8072d61651eb8e32f498703058c2fd"

func TestBuiltinThemeDefinitionsAreCompleteAndClassified(t *testing.T) {
	definitions := builtinThemeDefinitions()
	require.Len(t, definitions, 24)

	modeCounts := map[model.ThemeMode]int{}
	fingerprints := make(map[string]struct{}, len(definitions))
	colorPattern := regexp.MustCompile(`^#[0-9a-f]{6}$`)
	for _, definition := range definitions {
		modeCounts[definition.Mode]++
		assert.Equal(t, model.ThemeSourceBuiltin, definition.SourceType)
		assert.Equal(t, "iTerm2 Color Schemes", definition.SourceName)
		assert.Equal(t, "Mark Badolato / iTerm2 Color Schemes contributors", definition.SourceAuthor)
		assert.Equal(t, "MIT collection; individual rights retained", definition.SourceLicense)
		assert.Equal(t, expectedBuiltinThemeVersion, definition.SourceVersion)
		assert.Contains(t, definition.SourceURL, expectedBuiltinThemeVersion)
		assert.True(t, definition.IsBuiltin)
		assert.Empty(t, definition.RawPayload)

		var payload model.TerminalColorPayload
		require.NoError(t, json.Unmarshal([]byte(definition.ColorPayload), &payload))
		assert.Equal(t, definition.Mode, themeimport.ClassifyMode(payload.Background))
		assert.True(t, colorPattern.MatchString(payload.Background))
		assert.True(t, colorPattern.MatchString(payload.Foreground))
		assert.True(t, colorPattern.MatchString(payload.Cursor))
		assert.True(t, colorPattern.MatchString(payload.Selection))
		require.Len(t, payload.ANSI, 16)
		for _, color := range payload.ANSI {
			assert.True(t, colorPattern.MatchString(color))
		}

		assert.NotEmpty(t, definition.SourceFingerprint)
		_, duplicate := fingerprints[definition.SourceFingerprint]
		assert.False(t, duplicate, "duplicate fingerprint for %s", definition.Name)
		fingerprints[definition.SourceFingerprint] = struct{}{}
	}

	assert.Equal(t, 12, modeCounts[model.ThemeModeDark])
	assert.Equal(t, 12, modeCounts[model.ThemeModeLight])
}

func TestBuiltinThemeDefinitionsContainApprovedNames(t *testing.T) {
	names := make(map[string]struct{})
	for _, definition := range builtinThemeDefinitions() {
		names[definition.Name] = struct{}{}
	}
	for _, name := range []string{"GitHub Dark", "Dracula", "Monokai Remastered", "GitHub Light", "Tomorrow", "3024 Day"} {
		assert.Contains(t, names, name)
	}
}
