//go:build e2e

package e2e_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBindingsUseNpmRuntime verifies generated bindings import from @wailsio/runtime
// NOT from /wails/runtime.js (absolute path). The latter cannot be resolved by Vite.
func TestBindingsUseNpmRuntime(t *testing.T) {
	bindingsDir := serviceBindingsDir()
	entries, err := os.ReadDir(bindingsDir)
	require.NoError(t, err)

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".ts") || entry.Name() == "index.ts" {
			continue
		}
		content, err := os.ReadFile(filepath.Join(bindingsDir, entry.Name()))
		require.NoError(t, err)

		assert.False(t, strings.Contains(string(content), `"/wails/runtime.js"`),
			"%s imports from /wails/runtime.js — regenerate WITHOUT -b flag: wails3 generate bindings -ts -names -d frontend/bindings/ .", entry.Name())

		assert.True(t, strings.Contains(string(content), `"@wailsio/runtime"`),
			"%s does not import from @wailsio/runtime — regenerate WITHOUT -b flag", entry.Name())
	}
}

func TestObsoleteBindingsAbsent(t *testing.T) {
	tests := []struct {
		file    string
		methods []string
	}{
		{file: "settingservice.ts", methods: []string{"GetSetting", "SetSetting"}},
		{file: "sessionservice.ts", methods: []string{"Connect", "Disconnect"}},
		{file: "logservice.ts", methods: []string{"StartRecording", "StopRecording", "CloseAllActiveRecordings"}},
	}

	for _, test := range tests {
		content, err := os.ReadFile(filepath.Join(serviceBindingsDir(), test.file))
		require.NoError(t, err)
		for _, method := range test.methods {
			assert.NotContains(t, string(content), "export function "+method+"(")
			assert.NotContains(t, string(content), "."+method+`"`)
		}
	}
}

func serviceBindingsDir() string {
	return filepath.Join("..", "frontend", "bindings", "github.com", "xuthus5", "mssh", "internal", "service")
}

// TestWailsRuntimeNpmInstalled verifies @wailsio/runtime is a dependency in package.json.
func TestWailsRuntimeNpmInstalled(t *testing.T) {
	pkgPath := filepath.Join("..", "frontend", "package.json")
	content, err := os.ReadFile(pkgPath)
	require.NoError(t, err)

	assert.True(t, strings.Contains(string(content), `"@wailsio/runtime"`),
		"@wailsio/runtime not found in package.json — run: npm install @wailsio/runtime")
}
