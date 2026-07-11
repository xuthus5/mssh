package service

import (
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"

	"golang.org/x/image/font/sfnt"
)

const fallbackFontFamily = "sans-serif"

type FontService struct {
	roots  []string
	logger *slog.Logger
	once   sync.Once
	fonts  []string
}

func NewFontService(logger *slog.Logger) *FontService {
	home, _ := os.UserHomeDir()
	return newFontService(fontDirectories(runtime.GOOS, home, os.Getenv("WINDIR"), os.Getenv("LOCALAPPDATA")), logger)
}

func newFontService(roots []string, logger *slog.Logger) *FontService {
	return &FontService{roots: slices.Clone(roots), logger: logger}
}

func (s *FontService) List() []string {
	s.once.Do(func() { s.fonts = s.scan() })
	return slices.Clone(s.fonts)
}

func (s *FontService) scan() []string {
	families := make(map[string]struct{})
	for _, root := range s.roots {
		s.scanRoot(root, families)
	}

	fonts := make([]string, 0, len(families))
	for family := range families {
		fonts = append(fonts, family)
	}
	slices.Sort(fonts)
	if len(fonts) == 0 {
		return []string{fallbackFontFamily}
	}
	return fonts
}

func (s *FontService) scanRoot(root string, families map[string]struct{}) {
	if root == "" {
		return
	}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !isFontFile(path) {
			return nil
		}
		for _, family := range fontFamilies(path) {
			families[family] = struct{}{}
		}
		return nil
	})
	if err != nil {
		s.logger.Debug("scan font directory failed", "path", root, "error", err)
	}
}

func isFontFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".ttf", ".otf", ".ttc":
		return true
	default:
		return false
	}
}

func fontFamilies(path string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	collection, err := sfnt.ParseCollection(data)
	if err != nil {
		return nil
	}

	families := make([]string, 0, collection.NumFonts())
	var buffer sfnt.Buffer
	for index := range collection.NumFonts() {
		font, fontErr := collection.Font(index)
		if fontErr != nil {
			continue
		}
		family, nameErr := font.Name(&buffer, sfnt.NameIDFamily)
		if nameErr != nil {
			continue
		}
		family = strings.TrimSpace(family)
		if family != "" {
			families = append(families, family)
		}
	}
	return families
}

func fontDirectories(goos, home, windowsDir, localAppData string) []string {
	switch goos {
	case "windows":
		return compactPaths([]string{
			windowsJoin(windowsDir, "Fonts"),
			windowsJoin(localAppData, "Microsoft", "Windows", "Fonts"),
		})
	case "darwin":
		return compactPaths([]string{
			"/System/Library/Fonts",
			"/Library/Fonts",
			filepath.Join(home, "Library", "Fonts"),
		})
	default:
		return compactPaths([]string{
			"/usr/share/fonts",
			"/usr/local/share/fonts",
			filepath.Join(home, ".fonts"),
			filepath.Join(home, ".local", "share", "fonts"),
		})
	}
}

func windowsJoin(parts ...string) string {
	result := ""
	for _, part := range parts {
		if part == "" {
			return ""
		}
		if result == "" {
			result = strings.TrimRight(part, `\`)
			continue
		}
		result += `\` + strings.Trim(part, `\`)
	}
	return result
}

func compactPaths(paths []string) []string {
	return slices.DeleteFunc(paths, func(path string) bool { return path == "" || path == "." })
}
