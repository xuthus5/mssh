package model

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTerminalColorPayloadJSONRoundTrip(t *testing.T) {
	payload := TerminalColorPayload{Background: "#000000", Foreground: "#ffffff", Cursor: "#ffffff", Selection: "#264f78", ANSI: []string{"#000000", "#ffffff"}}
	data, err := json.Marshal(payload)
	require.NoError(t, err)
	var decoded TerminalColorPayload
	require.NoError(t, json.Unmarshal(data, &decoded))
	assert.Equal(t, payload, decoded)
}

func TestThemeCatalogInputConversionsExcludeServerFields(t *testing.T) {
	definition := ThemeDefinition{ID: 4, Name: "GitHub Dark", Mode: ThemeModeDark, SourceType: ThemeSourceBuiltin, SourceFingerprint: "sha256", IsBuiltin: true}
	profile := ThemeProfile{ID: 7, Name: "GitHub Dark", ThemeID: 4, FontFamily: "monospace", FontSize: 14, CursorStyle: CursorStyleBar, ColorOverrides: `{}`}

	assert.Equal(t, definition, ThemeDefinitionInputFrom(definition).ThemeDefinition())
	assert.Equal(t, profile, ThemeProfileInputFrom(profile).ThemeProfile())
	assert.Equal(t, ThemeAssignments{DarkProfileID: 7, LightProfileID: 8}, ThemeAssignmentsInput{DarkProfileID: 7, LightProfileID: 8}.ThemeAssignments())
}

func TestThemeCatalogEnums(t *testing.T) {
	assert.Equal(t, ThemeMode("dark"), ThemeModeDark)
	assert.Equal(t, ThemeMode("light"), ThemeModeLight)
	assert.Equal(t, ThemeMode("universal"), ThemeModeUniversal)
	assert.Equal(t, ThemeSourceType("iterm2"), ThemeSourceITerm2)
	assert.Equal(t, CursorStyle("underline"), CursorStyleUnderline)
}
