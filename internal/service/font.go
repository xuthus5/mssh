package service

import (
	"context"
	"errors"
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

const (
	fallbackFontFamily = "sans-serif"
	maxFontFileBytes   = 64 << 20
)

var errFontServiceStopped = errors.New("font service is shutting down")

type FontService struct {
	roots            []string
	logger           *slog.Logger
	once             sync.Once
	fonts            []string
	lifecycle        serviceOperationGate
	lifecycleContext context.Context
	lifecycleCancel  context.CancelFunc
	walkDir          fontDirectoryWalker
}

type fontDirectoryWalker func(context.Context, string, fs.WalkDirFunc) error

func NewFontService(logger *slog.Logger) *FontService {
	home, _ := os.UserHomeDir()
	return newFontService(fontDirectories(runtime.GOOS, home, os.Getenv("WINDIR"), os.Getenv("LOCALAPPDATA")), logger)
}

func newFontService(roots []string, logger *slog.Logger) *FontService {
	if logger == nil {
		logger = slog.Default()
	}
	lifecycleContext, lifecycleCancel := context.WithCancel(context.Background())
	return &FontService{
		roots: slices.Clone(roots), logger: logger,
		lifecycleContext: lifecycleContext, lifecycleCancel: lifecycleCancel,
		walkDir: walkFontDirectory,
	}
}

func (s *FontService) List() []string {
	operationContext, finish, err := s.beginOperation()
	if err != nil {
		return []string{fallbackFontFamily}
	}
	defer finish()
	s.once.Do(func() { s.fonts = s.scan(operationContext) })
	return slices.Clone(s.fonts)
}

func (s *FontService) scan(ctx context.Context) []string {
	families := make(map[string]struct{})
	for _, root := range s.roots {
		if ctx.Err() != nil {
			return []string{fallbackFontFamily}
		}
		s.scanRoot(ctx, root, families)
	}
	if ctx.Err() != nil {
		return []string{fallbackFontFamily}
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

func (s *FontService) scanRoot(ctx context.Context, root string, families map[string]struct{}) {
	if root == "" {
		return
	}
	walkDir := s.walkDir
	if walkDir == nil {
		walkDir = walkFontDirectory
	}
	err := walkDir(ctx, root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !isFontFile(path) {
			return nil
		}
		for _, family := range fontFamilies(path) {
			families[family] = struct{}{}
		}
		return nil
	})
	if err != nil && ctx.Err() == nil {
		s.logger.Debug("scan font directory failed", "path", root, "error", err)
	}
}

func walkFontDirectory(ctx context.Context, root string, walkFn fs.WalkDirFunc) error {
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return fs.SkipAll
		}
		return walkFn(path, entry, walkErr)
	})
}

func (s *FontService) beginOperation() (context.Context, func(), error) {
	if s == nil {
		return nil, nil, errFontServiceStopped
	}
	finish, err := s.lifecycle.begin(errFontServiceStopped)
	if err != nil {
		return nil, nil, err
	}
	operationContext := s.lifecycleContext
	if operationContext == nil {
		operationContext = context.Background()
	}
	return operationContext, finish, nil
}

// Shutdown cancels font discovery, rejects new scans, and waits for active calls.
//
//wails:ignore
func (s *FontService) Shutdown() {
	if s == nil {
		return
	}
	s.lifecycle.stop()
	if s.lifecycleCancel != nil {
		s.lifecycleCancel()
	}
	s.lifecycle.wait()
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
	file, err := openBoundedRegularFile(path, "font file", maxFontFileBytes)
	if err != nil {
		return nil
	}
	defer func() { _ = file.Close() }()
	collection, err := sfnt.ParseCollectionReaderAt(file)
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
