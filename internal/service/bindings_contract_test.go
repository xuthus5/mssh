package service

import (
	"bytes"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGeneratedBindingsMatchGoContracts(t *testing.T) {
	repository := bindingRepositoryRoot(t)
	generated := filepath.Join(t.TempDir(), "bindings")
	command := exec.CommandContext(t.Context(), "wails3", "generate", "bindings", "-ts", "-names", "-d", generated, ".")
	command.Dir = repository
	output, err := command.CombinedOutput()
	require.NoError(t, err, "generate bindings: %s", output)

	committed := filepath.Join(repository, "frontend", "bindings")
	expected := bindingTypeScriptFiles(t, committed)
	actual := bindingTypeScriptFiles(t, generated)
	require.Equal(t, expected, actual, "generated binding file set is stale")
	for _, relative := range expected {
		want, readErr := os.ReadFile(filepath.Join(committed, relative))
		require.NoError(t, readErr)
		got, readErr := os.ReadFile(filepath.Join(generated, relative))
		require.NoError(t, readErr)
		assert.True(t, bytes.Equal(want, got), "binding %s is stale; regenerate Wails bindings", relative)
	}
}

func bindingRepositoryRoot(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	require.True(t, ok)
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "..", ".."))
}

func bindingTypeScriptFiles(t *testing.T, root string) []string {
	t.Helper()
	files := make([]string, 0)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".ts") {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files = append(files, relative)
		return nil
	})
	require.NoError(t, err)
	sort.Strings(files)
	return files
}
