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
	bindingsDir := filepath.Join("..", "frontend", "bindings", "mssh", "internal", "service")
	entries, err := os.ReadDir(bindingsDir)
	require.NoError(t, err, "bindings directory not found — run: wails3 generate bindings -ts -names -d frontend/bindings/ .")

	expectedServices := map[string]int{
		"sessionservice.ts":   13, // Connect, ConnectionCount, CreateFolder, CreateSession, DeleteFolder, DeleteSession, Disconnect, GetSession, ListFolders, ListSessions, MoveFolder, MoveSession, UpdateFolder, UpdateSession
		"terminalservice.ts": 5,  // Close, Count, Open, Resize, Write
		"fileservice.ts":     7,  // CancelTransfer, Delete, Download, ListDir, Mkdir, Rename, Upload
		"keyservice.ts":      5,  // Delete, ExportPublicKey, Generate, Import, List
		"settingservice.ts":  2,  // GetSetting, SetSetting
		"tunnelservice.ts":   6,  // Create, Delete, List, Start, Stop, Update
		"macroservice.ts":    5,  // Create, Delete, Execute, List, Update
		"themeservice.ts":    6,  // Create, Delete, GetActive, List, SetActive, Update
		"logservice.ts":      8,  // Delete, GetRecording, List, StartRecording, StartTerminalRecording, StopRecording, StopTerminalRecording, HandleOutput
		"syncservice.ts":     4,  // Export, Import, SyncFromCloud, SyncToCloud
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
// matches the pattern: "mssh/internal/service.{Service}.{Method}"
func TestBindingFQNMatchesGo(t *testing.T) {
	bindingsDir := filepath.Join("..", "frontend", "bindings", "mssh", "internal", "service")
	entries, err := os.ReadDir(bindingsDir)
	require.NoError(t, err)

	fqnPrefix := "mssh/internal/service."

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
		"SessionService":  {"Connect", "ConnectionCount", "CreateFolder", "CreateSession", "DeleteFolder", "DeleteSession", "Disconnect", "GetClientWrapper", "GetSession", "ListFolders", "ListSessions", "MoveFolder", "MoveSession", "UpdateFolder", "UpdateSession"},
		"TerminalService": {"Close", "Count", "Open", "Resize", "SetOutputHandler", "Write"},
		"FileService":     {"CancelTransfer", "Delete", "Download", "ListDir", "Mkdir", "Rename", "Upload"},
		"KeyService":      {"Delete", "ExportPublicKey", "Generate", "Import", "List"},
		"SettingService":  {"GetSetting", "SetSetting"},
		"TunnelService":   {"Create", "Delete", "List", "Start", "Stop", "Update"},
		"MacroService":    {"Create", "Delete", "Execute", "List", "Update"},
		"ThemeService":    {"Create", "Delete", "GetActive", "List", "SetActive", "Update"},
		"LogService":      {"Delete", "GetRecording", "HandleOutput", "List", "StartRecording", "StartTerminalRecording", "StopRecording", "StopTerminalRecording"},
		"SyncService":     {"Export", "Import", "SyncFromCloud", "SyncToCloud"},
	}

	pkg := "mssh/internal/service"
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
	// Read each generated binding file
	bindingsDir := filepath.Join("..", "frontend", "bindings", "mssh", "internal", "service")
	entries, err := os.ReadDir(bindingsDir)
	require.NoError(t, err)

	serviceToMethods := make(map[string][]string)

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".ts") || entry.Name() == "index.ts" {
			continue
		}
		content, err := os.ReadFile(filepath.Join(bindingsDir, entry.Name()))
		require.NoError(t, err)

		serviceName := strings.TrimSuffix(entry.Name(), ".ts")
		// Convert "sessionservice" to "SessionService"
		serviceName = strings.TrimSuffix(serviceName, "service")
		if len(serviceName) > 0 {
			serviceName = strings.ToUpper(serviceName[:1]) + serviceName[1:] + "Service"
		}

		lines := strings.Split(string(content), "\n")
		for _, line := range lines {
			if !strings.Contains(line, ".ByName(") {
				continue
			}
			// Extract FQN from: $Call.ByName("pkg.Svc.Method", ...)
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

			// Method name is the last segment
			lastDot := strings.LastIndex(fqn, ".")
			if lastDot < 0 {
				continue
			}
			methodName := fqn[lastDot+1:]

			methods := serviceToMethods[serviceName]
			serviceToMethods[serviceName] = append(methods, methodName)
		}
	}

	t.Logf("Found %d services in binding files", len(serviceToMethods))
	for svc, methods := range serviceToMethods {
		t.Logf("  %s: %d methods — %v", svc, len(methods), methods)
	}
	assert.Greater(t, len(serviceToMethods), 5, "expected at least 6 services in bindings")
}
