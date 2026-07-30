package service

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
)

func installAIAgentTestLauncher(t *testing.T, directory, name, testName string) string {
	t.Helper()
	testBinary, err := os.Executable()
	require.NoError(t, err)
	t.Setenv("MSSH_TEST_BINARY", testBinary)
	path := filepath.Join(directory, name)
	content := "#!/bin/sh\nexec \"$MSSH_TEST_BINARY\" -test.run='^" + testName + "$' -- \"$@\"\n"
	if runtime.GOOS == "windows" {
		path += ".cmd"
		content = "@echo off\r\n\"%MSSH_TEST_BINARY%\" -test.run=^" + testName + "$ -- %*\r\n"
		if os.Getenv("PATHEXT") == "" {
			t.Setenv("PATHEXT", ".COM;.EXE;.BAT;.CMD")
		}
	}
	require.NoError(t, os.WriteFile(path, []byte(content), 0o700))
	return path
}

func setAIAgentTestPath(t *testing.T, directory string) {
	t.Helper()
	t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))
}
