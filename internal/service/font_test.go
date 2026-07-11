package service

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/image/font/gofont/goregular"
)

func TestFontServiceListsSortedUniqueFamiliesAndCachesResult(t *testing.T) {
	t.Parallel()

	fontDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(fontDir, "regular.ttf"), goregular.TTF, 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(fontDir, "duplicate.otf"), goregular.TTF, 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(fontDir, "broken.ttc"), []byte("invalid"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(fontDir, "ignored.txt"), goregular.TTF, 0o600))

	fontService := newFontService([]string{fontDir}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	require.Equal(t, []string{"Go"}, fontService.List())

	require.NoError(t, os.Remove(filepath.Join(fontDir, "regular.ttf")))
	require.NoError(t, os.Remove(filepath.Join(fontDir, "duplicate.otf")))
	require.Equal(t, []string{"Go"}, fontService.List())
}

func TestFontServiceFallsBackWhenNoFontsAreAvailable(t *testing.T) {
	t.Parallel()

	fontService := newFontService([]string{t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	require.Equal(t, []string{"sans-serif"}, fontService.List())
}

func TestFontDirectoriesUsePlatformLocations(t *testing.T) {
	t.Parallel()

	require.Equal(t, []string{
		`C:\Windows\Fonts`,
		`C:\Users\tester\AppData\Local\Microsoft\Windows\Fonts`,
	}, fontDirectories("windows", `C:\Users\tester`, `C:\Windows`, `C:\Users\tester\AppData\Local`))
	require.Equal(t, []string{
		"/usr/share/fonts",
		"/usr/local/share/fonts",
		"/home/tester/.fonts",
		"/home/tester/.local/share/fonts",
	}, fontDirectories("linux", "/home/tester", "", ""))
	require.Equal(t, []string{
		"/System/Library/Fonts",
		"/Library/Fonts",
		"/Users/tester/Library/Fonts",
	}, fontDirectories("darwin", "/Users/tester", "", ""))
}
