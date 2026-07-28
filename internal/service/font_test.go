package service

import (
	"context"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

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

func TestFontServiceSkipsOversizedFontFiles(t *testing.T) {
	t.Parallel()

	fontDir := t.TempDir()
	oversized := filepath.Join(fontDir, "oversized.ttc")
	require.NoError(t, os.WriteFile(oversized, nil, 0o600))
	require.NoError(t, os.Truncate(oversized, 64<<20+1))
	require.NoError(t, os.WriteFile(filepath.Join(fontDir, "regular.ttf"), goregular.TTF, 0o600))

	fontService := newFontService([]string{fontDir}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	require.Equal(t, []string{"Go"}, fontService.List())
}

func TestFontServiceHandlesEmptyAndMissingRoots(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	fontService := newFontService([]string{"", filepath.Join(t.TempDir(), "missing")}, logger)

	require.Equal(t, []string{"sans-serif"}, fontService.List())
	require.Empty(t, windowsJoin(`C:\Windows`, "", "Fonts"))
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

func TestFontServiceShutdownCancelsAndWaitsForActiveScan(t *testing.T) {
	fontService := newFontService([]string{"/fonts"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	scanStarted := make(chan struct{})
	scanCanceled := make(chan struct{})
	releaseScan := make(chan struct{})
	var scanCalls atomic.Int32
	fontService.walkDir = func(ctx context.Context, _ string, _ fs.WalkDirFunc) error {
		scanCalls.Add(1)
		close(scanStarted)
		<-ctx.Done()
		close(scanCanceled)
		<-releaseScan
		return ctx.Err()
	}

	listDone := make(chan []string, 1)
	go func() { listDone <- fontService.List() }()
	<-scanStarted
	shutdownDone := make(chan struct{})
	go func() {
		fontService.Shutdown()
		close(shutdownDone)
	}()
	<-scanCanceled
	select {
	case <-shutdownDone:
		t.Fatal("font shutdown returned before the active scan completed")
	case <-time.After(50 * time.Millisecond):
	}

	close(releaseScan)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("font shutdown did not finish after the scan completed")
	}
	require.Equal(t, []string{fallbackFontFamily}, <-listDone)
	require.Equal(t, []string{fallbackFontFamily}, fontService.List())
	require.Equal(t, int32(1), scanCalls.Load())
	fontService.Shutdown()
}

func TestFontServiceShutdownHandlesNilReceiver(t *testing.T) {
	var fontService *FontService
	require.NotPanics(t, fontService.Shutdown)
	require.Equal(t, []string{fallbackFontFamily}, fontService.List())
}
