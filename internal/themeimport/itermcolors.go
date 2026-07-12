package themeimport

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

type ITermColorsImporter struct{}

func NewITermColorsImporter() *ITermColorsImporter { return &ITermColorsImporter{} }

func (importer *ITermColorsImporter) Supports(filename string, _ []byte) bool {
	return strings.EqualFold(filepath.Ext(filename), ".itermcolors")
}

func (importer *ITermColorsImporter) Import(filename string, content []byte) ([]model.ThemeDefinition, error) {
	if containsXMLExternalReference(content) {
		return nil, fmt.Errorf("XML entities and document types are not allowed")
	}
	colors, err := parseITermColors(content)
	if err != nil {
		return nil, err
	}
	payload, err := buildPayload(colors)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode terminal colors: %w", err)
	}
	sum := sha256.Sum256(encoded)
	definition := model.ThemeDefinition{
		Name:              strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename)),
		Mode:              classifyMode(payload.Background),
		SourceType:        model.ThemeSourceITerm2,
		SourceName:        "iTerm2 Color Schemes",
		SourceLicense:     "unknown",
		SourceFingerprint: hex.EncodeToString(sum[:]),
		ColorPayload:      string(encoded),
		RawPayload:        string(content),
	}
	return []model.ThemeDefinition{definition}, nil
}

func containsXMLExternalReference(content []byte) bool {
	upper := bytes.ToUpper(content)
	return bytes.Contains(upper, []byte("<!DOCTYPE")) || bytes.Contains(upper, []byte("<!ENTITY"))
}

func parseITermColors(content []byte) (map[string]map[string]string, error) {
	decoder := xml.NewDecoder(bytes.NewReader(content))
	colors := make(map[string]map[string]string)
	depth := 0
	var colorKey, componentKey string
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("parse iTerm2 plist: %w", err)
		}
		switch element := token.(type) {
		case xml.StartElement:
			if element.Name.Local == "dict" {
				depth++
				continue
			}
			if element.Name.Local == "key" {
				var value string
				if err = decoder.DecodeElement(&value, &element); err != nil {
					return nil, fmt.Errorf("parse iTerm2 key: %w", err)
				}
				if depth == 1 {
					colorKey = value
					colors[colorKey] = make(map[string]string)
				} else if depth == 2 {
					componentKey = value
				}
			} else if depth == 2 && (element.Name.Local == "real" || element.Name.Local == "integer" || element.Name.Local == "string") {
				var value string
				if err = decoder.DecodeElement(&value, &element); err != nil {
					return nil, fmt.Errorf("parse iTerm2 component: %w", err)
				}
				colors[colorKey][componentKey] = value
			}
		case xml.EndElement:
			if element.Name.Local == "dict" {
				depth--
				if depth < 2 {
					componentKey = ""
				}
			}
		}
	}
	return colors, nil
}

func buildPayload(colors map[string]map[string]string) (model.TerminalColorPayload, error) {
	background, err := convertColor(colors, "Background Color")
	if err != nil {
		return model.TerminalColorPayload{}, err
	}
	foreground, err := convertColor(colors, "Foreground Color")
	if err != nil {
		return model.TerminalColorPayload{}, err
	}
	cursor, err := convertColor(colors, "Cursor Color")
	if err != nil {
		return model.TerminalColorPayload{}, err
	}
	selection, err := convertColor(colors, "Selection Color")
	if err != nil {
		return model.TerminalColorPayload{}, err
	}
	ansi := make([]string, 16)
	for index := range ansi {
		ansi[index], err = convertColor(colors, fmt.Sprintf("Ansi %d Color", index))
		if err != nil {
			return model.TerminalColorPayload{}, err
		}
	}
	return model.TerminalColorPayload{Background: background, Foreground: foreground, Cursor: cursor, Selection: selection, ANSI: ansi}, nil
}

func convertColor(colors map[string]map[string]string, name string) (string, error) {
	components, ok := colors[name]
	if !ok {
		return "", fmt.Errorf("missing %s", name)
	}
	values := make([]int, 3)
	for index, component := range []string{"Red Component", "Green Component", "Blue Component"} {
		raw, exists := components[component]
		if !exists {
			return "", fmt.Errorf("missing %s in %s", component, name)
		}
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return "", fmt.Errorf("parse %s in %s: %w", component, name, err)
		}
		values[index] = int(math.Round(math.Max(0, math.Min(1, value)) * 255))
	}
	return fmt.Sprintf("#%02x%02x%02x", values[0], values[1], values[2]), nil
}

func classifyMode(background string) model.ThemeMode {
	red, _ := strconv.ParseInt(background[1:3], 16, 64)
	green, _ := strconv.ParseInt(background[3:5], 16, 64)
	blue, _ := strconv.ParseInt(background[5:7], 16, 64)
	luminance := 0.2126*float64(red)/255 + 0.7152*float64(green)/255 + 0.0722*float64(blue)/255
	if luminance > 0.5 {
		return model.ThemeModeLight
	}
	return model.ThemeModeDark
}
