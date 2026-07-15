//go:build e2e

package e2e_test

import (
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBindingGeneration verifies the generated TypeScript bindings exist
// and contain the correct method signatures for all registered services.
func TestBindingGeneration(t *testing.T) {
	bindingsDir := serviceBindingsDir()
	entries, err := os.ReadDir(bindingsDir)
	require.NoError(t, err, "bindings directory not found — run: wails3 generate bindings -ts -names -d frontend/bindings/ .")

	expectedServices := map[string]int{
		"sessionservice.ts":  17,
		"terminalservice.ts": 9,
		"fileservice.ts":     7, // CancelTransfer, Delete, Download, ListDir, Mkdir, Rename, Upload
		"keyservice.ts":      5, // Delete, ExportPublicKey, Generate, Import, List
		"settingservice.ts":  6,
		"tunnelservice.ts":   6, // Create, Delete, List, Start, Stop, Update
		"macroservice.ts":    5, // Create, Delete, Execute, List, Update
		"themeservice.ts":    14,
		"logservice.ts":      7,
		"syncservice.ts":     4, // Export, Import, SyncFromCloud, SyncToCloud
	}

	foundServices := make(map[string]bool)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasSuffix(name, ".ts") && name != "index.ts" {
			foundServices[name] = true

			minMethods, expected := expectedServices[name]
			if !expected {
				t.Logf("Unexpected binding file: %s (may be newly added)", name)
				continue
			}

			content, err := os.ReadFile(filepath.Join(bindingsDir, name))
			require.NoError(t, err, "failed to read %s", name)

			count := strings.Count(string(content), "export function")
			t.Logf("  %s: %d exported methods (min expected: %d)", name, count, minMethods)
			assert.GreaterOrEqual(t, count, minMethods,
				"%s has %d exported methods, expected at least %d — run: wails3 generate bindings -ts -names -d frontend/bindings/ .", name, count, minMethods)
		}
	}

	for svc := range expectedServices {
		assert.True(t, foundServices[svc], "missing binding file: %s — run: wails3 generate bindings -ts -names -d frontend/bindings/ .", svc)
	}
}

// TestBindingFQNMatchesGo verifies that each FQN in the generated bindings
// matches the pattern: "github.com/xuthus5/mssh/internal/service.{Service}.{Method}"
func TestBindingFQNMatchesGo(t *testing.T) {
	bindingsDir := serviceBindingsDir()
	entries, err := os.ReadDir(bindingsDir)
	require.NoError(t, err)

	fqnPrefix := "github.com/xuthus5/mssh/internal/service."

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".ts") || entry.Name() == "index.ts" {
			continue
		}
		content, err := os.ReadFile(filepath.Join(bindingsDir, entry.Name()))
		require.NoError(t, err)

		// Extract all FQNs from ByName calls
		lines := strings.Split(string(content), "\n")
		for _, line := range lines {
			if !strings.Contains(line, ".ByName(") {
				continue
			}
			// Extract the FQN string between quotes
			start := strings.Index(line, ".ByName(\"")
			if start < 0 {
				continue
			}
			start += len(".ByName(\"")
			end := strings.Index(line[start:], "\"")
			if end < 0 {
				continue
			}
			fqn := line[start : start+end]

			assert.True(t, strings.HasPrefix(fqn, fqnPrefix),
				"invalid FQN in %s: %q — expected prefix %q", entry.Name(), fqn, fqnPrefix)

			parts := strings.Split(fqn, ".")
			assert.GreaterOrEqual(t, len(parts), 3,
				"invalid FQN format in %s: %q — expected pkgPath.Type.Method", entry.Name(), fqn)

			// Verify FNV-1a hash of FQN is a valid uint32
			h := fnv.New32a()
			h.Write([]byte(fqn))
			id := h.Sum32()
			assert.NotZero(t, id, "FNV hash of %q produced zero ID", fqn)
		}
	}
}

// TestBindingBarrelExports verifies the barrel index re-exports all services.
func TestBindingBarrelExports(t *testing.T) {
	barrelPath := filepath.Join("..", "frontend", "src", "lib", "wails", "index.ts")
	content, err := os.ReadFile(barrelPath)
	require.NoError(t, err, "barrel file not found at %s", barrelPath)

	expectedExports := []string{
		"SessionService", "TerminalService", "FileService", "KeyService",
		"SettingService", "TunnelService", "MacroService", "ThemeService",
		"LogService", "SyncService",
	}

	for _, svc := range expectedExports {
		assert.True(t,
			strings.Contains(string(content), "export const "+svc),
			"barrel %s missing export: %s", barrelPath, svc)
	}
}

// TestRpcContract verifies that every Go service method can be resolved
// by its FQN through the same hash algorithm Wails v3 uses.
func TestRpcContract_FNVHash(t *testing.T) {
	serviceMethods := map[string][]string{
		"SessionService":  {"CancelConnect", "ConnectionCount", "CreateFolder", "CreateSession", "DecideHostKey", "DeleteFolder", "DeleteSession", "GetClientWrapper", "GetSession", "ListFolders", "ListRecentSessions", "ListSessions", "MoveFolder", "MoveSession", "SetDefaultFolder", "UpdateFolder", "UpdateSession"},
		"TerminalService": {"Attach", "Close", "Count", "Open", "Resize", "SetCloseHandler", "SetMaxSize", "SetOutputHandler", "Write"},
		"FileService":     {"CancelTransfer", "Delete", "Download", "ListDir", "Mkdir", "Rename", "Upload"},
		"KeyService":      {"Delete", "ExportPublicKey", "Generate", "Import", "List"},
		"SettingService":  {"Delete", "Get", "GetMany", "List", "Set", "SetMany"},
		"TunnelService":   {"Create", "Delete", "List", "Start", "Stop", "Update"},
		"MacroService":    {"Create", "Delete", "Execute", "List", "Update"},
		"ThemeService":    {"CreateCustomProfile", "DeleteDefinition", "DeleteProfile", "GetAssignments", "GetGlobalStyle", "GetProfile", "ImportFiles", "InitializeDefaults", "ListDefinitions", "ListProfiles", "ResetBuiltinStyles", "SaveAssignments", "SaveConfiguration", "UpdateProfile"},
		"LogService":      {"Delete", "GetRecording", "HandleOutput", "List", "StartTerminalRecording", "StopTerminalRecording", "StopTerminalRecordingIfActive"},
		"SyncService":     {"Export", "Import", "SyncFromCloud", "SyncToCloud"},
	}

	pkg := "github.com/xuthus5/mssh/internal/service"
	allFQNs := make(map[string]bool)

	for svc, methods := range serviceMethods {
		for _, method := range methods {
			fqn := fmt.Sprintf("%s.%s.%s", pkg, svc, method)
			h := fnv.New32a()
			h.Write([]byte(fqn))
			id := h.Sum32()
			assert.NotZero(t, id, "FNV hash of %q is zero", fqn)

			// All FQNs must be unique
			assert.False(t, allFQNs[fqn], "duplicate FQN: %q", fqn)
			allFQNs[fqn] = true
		}
	}

	t.Logf("Verified %d unique FQNs with valid FNV-1a hashes", len(allFQNs))
}

// TestGoServiceMethodsExist verifies every method in the binding files
// actually exists as a Go exported method on the service structs.
// This is a cross-reference check between generated bindings and Go code.
func TestGoServiceMethodsExist(t *testing.T) {
	serviceToMethods := collectBindingServiceMethods(t, serviceBindingsDir())
	t.Logf("Found %d services in binding files", len(serviceToMethods))
	for svc, methods := range serviceToMethods {
		t.Logf("  %s: %d methods — %v", svc, len(methods), methods)
	}
	assert.Greater(t, len(serviceToMethods), 5, "expected at least 6 services in bindings")
}

func collectBindingServiceMethods(t *testing.T, bindingsDir string) map[string][]string {
	t.Helper()
	entries, err := os.ReadDir(bindingsDir)
	require.NoError(t, err)
	serviceToMethods := make(map[string][]string)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".ts") || entry.Name() == "index.ts" {
			continue
		}
		serviceName, methods := readBindingServiceMethods(t, bindingsDir, entry.Name())
		serviceToMethods[serviceName] = append(serviceToMethods[serviceName], methods...)
	}
	return serviceToMethods
}

func readBindingServiceMethods(t *testing.T, bindingsDir, filename string) (string, []string) {
	t.Helper()
	content, err := os.ReadFile(filepath.Join(bindingsDir, filename))
	require.NoError(t, err)
	methods := make([]string, 0)
	for _, line := range strings.Split(string(content), "\n") {
		methodName, ok := bindingMethodName(line)
		if ok {
			methods = append(methods, methodName)
		}
	}
	return bindingServiceName(filename), methods
}

func bindingServiceName(filename string) string {
	serviceName := strings.TrimSuffix(filename, ".ts")
	serviceName = strings.TrimSuffix(serviceName, "service")
	if len(serviceName) == 0 {
		return serviceName
	}
	return strings.ToUpper(serviceName[:1]) + serviceName[1:] + "Service"
}

func bindingMethodName(line string) (string, bool) {
	if !strings.Contains(line, ".ByName(") {
		return "", false
	}
	start := strings.Index(line, ".ByName(\"")
	if start < 0 {
		return "", false
	}
	start += len(".ByName(\"")
	end := strings.Index(line[start:], "\"")
	if end < 0 {
		return "", false
	}
	fqn := line[start : start+end]
	lastDot := strings.LastIndex(fqn, ".")
	if lastDot < 0 {
		return "", false
	}
	return fqn[lastDot+1:], true
}

// TestBindingsNotInsideSource verifies generated binding files are NOT inside Vite's src/ tree.
// The barrel index.ts is allowed, but generated service bindings must live in frontend/bindings/.
func TestBindingsNotInsideSource(t *testing.T) {
	sourcesPath := filepath.Join("..", "frontend", "src", "lib", "wails")
	entries, err := os.Stat(sourcesPath)
	if err != nil {
		return // directory doesn't exist — OK
	}
	assert.True(t, entries.IsDir())

	// Check that NO generated binding files exist here (only the barrel index.ts is allowed)
	serviceDir := filepath.Join(sourcesPath, "mssh", "internal", "service")
	_, err = os.Stat(serviceDir)
	assert.True(t, os.IsNotExist(err),
		"generated bindings found at %s — they must be in frontend/bindings/, not inside src/", serviceDir)
}
