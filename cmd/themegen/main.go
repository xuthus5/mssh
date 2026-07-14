package main

import (
	"context"
	"errors"
	"fmt"
	"go/format"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/themeimport"
)

const (
	upstreamCommit = "c3968b385e8072d61651eb8e32f498703058c2fd"
	maxThemeBytes  = 2 << 20
	plistDoctype   = `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`
)

type manifestEntry struct {
	name     string
	filename string
	mode     model.ThemeMode
}

var manifest = []manifestEntry{
	{name: "GitHub Dark", filename: "GitHub Dark.itermcolors", mode: model.ThemeModeDark},
	{name: "Dracula", filename: "Dracula.itermcolors", mode: model.ThemeModeDark},
	{name: "Atom One Dark", filename: "Atom One Dark.itermcolors", mode: model.ThemeModeDark},
	{name: "Gruvbox Dark", filename: "Gruvbox Dark.itermcolors", mode: model.ThemeModeDark},
	{name: "iTerm2 Solarized Dark", filename: "iTerm2 Solarized Dark.itermcolors", mode: model.ThemeModeDark},
	{name: "Nord", filename: "Nord.itermcolors", mode: model.ThemeModeDark},
	{name: "Catppuccin Mocha", filename: "Catppuccin Mocha.itermcolors", mode: model.ThemeModeDark},
	{name: "TokyoNight Night", filename: "TokyoNight Night.itermcolors", mode: model.ThemeModeDark},
	{name: "Rose Pine Moon", filename: "Rose Pine Moon.itermcolors", mode: model.ThemeModeDark},
	{name: "Kanagawa Wave", filename: "Kanagawa Wave.itermcolors", mode: model.ThemeModeDark},
	{name: "Everforest Dark Med", filename: "Everforest Dark Med.itermcolors", mode: model.ThemeModeDark},
	{name: "Monokai Remastered", filename: "Monokai Remastered.itermcolors", mode: model.ThemeModeDark},
	{name: "GitHub Light", filename: "GitHub Light Default.itermcolors", mode: model.ThemeModeLight},
	{name: "Atom One Light", filename: "Atom One Light.itermcolors", mode: model.ThemeModeLight},
	{name: "Gruvbox Light", filename: "Gruvbox Light.itermcolors", mode: model.ThemeModeLight},
	{name: "iTerm2 Solarized Light", filename: "iTerm2 Solarized Light.itermcolors", mode: model.ThemeModeLight},
	{name: "Catppuccin Latte", filename: "Catppuccin Latte.itermcolors", mode: model.ThemeModeLight},
	{name: "TokyoNight Day", filename: "TokyoNight Day.itermcolors", mode: model.ThemeModeLight},
	{name: "Rose Pine Dawn", filename: "Rose Pine Dawn.itermcolors", mode: model.ThemeModeLight},
	{name: "Kanagawa Lotus", filename: "Kanagawa Lotus.itermcolors", mode: model.ThemeModeLight},
	{name: "Everforest Light Med", filename: "Everforest Light Med.itermcolors", mode: model.ThemeModeLight},
	{name: "Nord Light", filename: "Nord Light.itermcolors", mode: model.ThemeModeLight},
	{name: "Tomorrow", filename: "Tomorrow.itermcolors", mode: model.ThemeModeLight},
	{name: "3024 Day", filename: "3024 Day.itermcolors", mode: model.ThemeModeLight},
}

func main() {
	client := &http.Client{Timeout: 30 * time.Second}
	if err := run(client, "builtin_themes_gen.go"); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(client *http.Client, outputFilename string) error {
	definitions, err := loadDefinitions(context.Background(), client)
	if err != nil {
		return err
	}
	source, err := renderDefinitions(definitions)
	if err != nil {
		return err
	}
	if err = writeGeneratedFile(outputFilename, source); err != nil {
		return err
	}
	return nil
}

func loadDefinitions(ctx context.Context, client *http.Client) ([]model.ThemeDefinition, error) {
	definitions := make([]model.ThemeDefinition, 0, len(manifest))
	fingerprints := make(map[string]string, len(manifest))
	for _, entry := range manifest {
		definition, err := loadDefinition(ctx, client, entry)
		if err != nil {
			return nil, err
		}
		if existing, duplicate := fingerprints[definition.SourceFingerprint]; duplicate {
			return nil, fmt.Errorf("duplicate theme fingerprint for %s and %s", existing, definition.Name)
		}
		fingerprints[definition.SourceFingerprint] = definition.Name
		definitions = append(definitions, definition)
	}
	return definitions, nil
}

func loadDefinition(ctx context.Context, client *http.Client, entry manifestEntry) (model.ThemeDefinition, error) {
	sourceURL := rawThemeURL(entry.filename)
	content, err := download(ctx, client, sourceURL)
	if err != nil {
		return model.ThemeDefinition{}, fmt.Errorf("download %s: %w", entry.name, err)
	}
	content = []byte(strings.Replace(string(content), plistDoctype, "", 1))
	definitions, err := themeimport.NewITermColorsImporter().Import(entry.filename, content)
	if err != nil {
		return model.ThemeDefinition{}, fmt.Errorf("parse %s: %w", entry.name, err)
	}
	if len(definitions) != 1 || definitions[0].Mode != entry.mode {
		return model.ThemeDefinition{}, fmt.Errorf("classify %s: got %v, want %s", entry.name, definitions, entry.mode)
	}
	definition := definitions[0]
	definition.Name = entry.name
	definition.SourceType = model.ThemeSourceBuiltin
	definition.SourceName = "iTerm2 Color Schemes"
	definition.SourceURL = sourceURL
	definition.SourceAuthor = "Mark Badolato / iTerm2 Color Schemes contributors"
	definition.SourceLicense = "MIT collection; individual rights retained"
	definition.SourceVersion = upstreamCommit
	definition.SourceFingerprint = "builtin:" + definition.SourceFingerprint
	definition.RawPayload = ""
	definition.IsBuiltin = true
	return definition, nil
}

func download(ctx context.Context, client *http.Client, sourceURL string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %s", response.Status)
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, maxThemeBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if len(content) > maxThemeBytes {
		return nil, fmt.Errorf("theme exceeds %d bytes", maxThemeBytes)
	}
	return content, nil
}

func rawThemeURL(filename string) string {
	return "https://raw.githubusercontent.com/mbadolato/iTerm2-Color-Schemes/" + upstreamCommit + "/schemes/" + url.PathEscape(filename)
}

func renderDefinitions(definitions []model.ThemeDefinition) ([]byte, error) {
	var builder strings.Builder
	_, _ = builder.WriteString("// Code generated by cmd/themegen; DO NOT EDIT.\n\npackage service\n\nimport \"github.com/xuthus5/mssh/internal/model\"\n\n")
	_, _ = builder.WriteString("func builtinThemeDefinitions() []model.ThemeDefinition {\n\treturn []model.ThemeDefinition{\n")
	for _, definition := range definitions {
		_, _ = fmt.Fprintf(&builder, "\t\t{Name: %s, Mode: model.ThemeMode(%s), SourceType: model.ThemeSourceBuiltin, SourceName: %s, SourceURL: %s, SourceAuthor: %s, SourceLicense: %s, SourceVersion: %s, SourceFingerprint: %s, ColorPayload: %s, IsBuiltin: true},\n", quote(definition.Name), quote(string(definition.Mode)), quote(definition.SourceName), quote(definition.SourceURL), quote(definition.SourceAuthor), quote(definition.SourceLicense), quote(definition.SourceVersion), quote(definition.SourceFingerprint), quote(definition.ColorPayload))
	}
	_, _ = builder.WriteString("\t}\n}\n")
	formatted, err := format.Source([]byte(builder.String()))
	if err != nil {
		return nil, fmt.Errorf("format generated source: %w", err)
	}
	return formatted, nil
}

func quote(value string) string { return strconv.Quote(value) }

func writeGeneratedFile(filename string, content []byte) error {
	directory := filepath.Dir(filename)
	pattern := "." + filepath.Base(filename) + "-*"
	file, err := os.CreateTemp(directory, pattern)
	if err != nil {
		return fmt.Errorf("create generated file: %w", err)
	}
	temporary := file.Name()
	defer func() { _ = os.Remove(temporary) }()
	if _, err = file.Write(content); err == nil {
		err = file.Close()
	} else {
		_ = file.Close()
	}
	if err != nil {
		return fmt.Errorf("write generated file: %w", err)
	}
	if err = replaceGeneratedFile(temporary, filename); err != nil {
		return fmt.Errorf("replace generated file: %w", err)
	}
	return nil
}

func replaceGeneratedFile(temporary, filename string) error {
	if info, err := os.Stat(filename); err == nil && info.IsDir() {
		return fmt.Errorf("target is a directory")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect target: %w", err)
	}
	if err := os.Rename(temporary, filename); err == nil {
		return nil
	}
	if err := os.Remove(filename); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove existing target: %w", err)
	}
	if err := os.Rename(temporary, filename); err != nil {
		return fmt.Errorf("rename generated file: %w", err)
	}
	return nil
}
