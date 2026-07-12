package themeimport

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestITermColorsImporterParsesAndClassifies(t *testing.T) {
	importer := NewITermColorsImporter()
	dark, err := importer.Import("Dracula.itermcolors", []byte(itermFixture(0.1)))
	require.NoError(t, err)
	require.Len(t, dark, 1)
	assert.Equal(t, "Dracula", dark[0].Name)
	assert.Equal(t, model.ThemeModeDark, dark[0].Mode)
	assert.Equal(t, model.ThemeSourceITerm2, dark[0].SourceType)
	assert.NotEmpty(t, dark[0].SourceFingerprint)

	light, err := importer.Import("Paper.itermcolors", []byte(itermFixture(0.95)))
	require.NoError(t, err)
	assert.Equal(t, model.ThemeModeLight, light[0].Mode)
	assert.NotEqual(t, dark[0].SourceFingerprint, light[0].SourceFingerprint)
}

func TestITermColorsImporterValidatesInput(t *testing.T) {
	importer := NewITermColorsImporter()
	assert.True(t, importer.Supports("theme.itermcolors", nil))
	assert.False(t, importer.Supports("theme.json", nil))
	_, err := importer.Import("broken.itermcolors", []byte(`<plist><dict>`+plistColor("Background Color", 0, 0, 0)+`</dict></plist>`))
	assert.ErrorContains(t, err, "Foreground Color")
	_, err = importer.Import("entity.itermcolors", []byte(`<!DOCTYPE plist [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><plist/>`))
	assert.ErrorContains(t, err, "entities")
}

func TestITermColorsFingerprintIsStable(t *testing.T) {
	importer := NewITermColorsImporter()
	first, err := importer.Import("one.itermcolors", []byte(itermFixture(0.2)))
	require.NoError(t, err)
	second, err := importer.Import("two.itermcolors", []byte(itermFixture(0.2)))
	require.NoError(t, err)
	assert.Equal(t, first[0].SourceFingerprint, second[0].SourceFingerprint)
}

func TestConvertColorValidatesAndClampsComponents(t *testing.T) {
	_, err := convertColor(map[string]map[string]string{}, "Missing")
	assert.ErrorContains(t, err, "missing Missing")
	_, err = convertColor(map[string]map[string]string{"Color": {"Red Component": "0"}}, "Color")
	assert.ErrorContains(t, err, "Green Component")
	_, err = convertColor(map[string]map[string]string{"Color": {
		"Red Component": "invalid", "Green Component": "0", "Blue Component": "0",
	}}, "Color")
	assert.ErrorContains(t, err, "parse Red Component")

	color, err := convertColor(map[string]map[string]string{"Color": {
		"Red Component": "-1", "Green Component": "0.5", "Blue Component": "2",
	}}, "Color")
	require.NoError(t, err)
	assert.Equal(t, "#0080ff", color)
}

func TestParseITermColorsSupportsIntegerAndStringComponents(t *testing.T) {
	colors, err := parseITermColors([]byte(`<plist><dict><key>Color</key><dict><key>Red Component</key><integer>1</integer><key>Green Component</key><string>0.5</string></dict></dict></plist>`))
	require.NoError(t, err)
	assert.Equal(t, "1", colors["Color"]["Red Component"])
	assert.Equal(t, "0.5", colors["Color"]["Green Component"])
}

func TestParseITermColorsReportsMalformedKeysAndComponents(t *testing.T) {
	_, err := parseITermColors([]byte(`<plist><dict><key><broken></key></dict></plist>`))
	assert.ErrorContains(t, err, "parse iTerm2 key")
	_, err = parseITermColors([]byte(`<plist><dict><key>Color</key><dict><key>Red Component</key><real><broken></real></dict></dict></plist>`))
	assert.ErrorContains(t, err, "parse iTerm2 component")
}

func itermFixture(background float64) string {
	entries := []string{
		plistColor("Background Color", background, background, background),
		plistColor("Foreground Color", 0.8, 0.8, 0.8),
		plistColor("Cursor Color", 1, 1, 1),
		plistColor("Selection Color", 0.2, 0.3, 0.4),
	}
	for index := range 16 {
		component := float64(index) / 15
		entries = append(entries, plistColor(fmt.Sprintf("Ansi %d Color", index), component, component, component))
	}
	return `<?xml version="1.0"?><plist version="1.0"><dict>` + strings.Join(entries, "") + `</dict></plist>`
}

func plistColor(name string, red, green, blue float64) string {
	return fmt.Sprintf(`<key>%s</key><dict><key>Red Component</key><real>%.6f</real><key>Green Component</key><real>%.6f</real><key>Blue Component</key><real>%.6f</real><key>Color Space</key><string>sRGB</string></dict>`, name, red, green, blue)
}
