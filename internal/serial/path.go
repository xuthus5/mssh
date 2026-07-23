package serial

import (
	"path/filepath"
	"runtime"
	"strings"
)

// CanonicalDevicePath normalizes a serial device path for exclusive-open comparison.
// On Unix it resolves symlinks when possible; on Windows it uppercases COM names.
func CanonicalDevicePath(device string) string {
	device = strings.TrimSpace(device)
	if device == "" {
		return ""
	}
	if runtime.GOOS == "windows" {
		return canonicalWindowsDevice(device)
	}
	return canonicalUnixDevice(device)
}

func canonicalWindowsDevice(device string) string {
	cleaned := strings.TrimRight(device, `\/`)
	upper := strings.ToUpper(cleaned)
	// Accept both COM3 and \\.\COM3 forms.
	if strings.HasPrefix(upper, `\\.\`) {
		return upper
	}
	if strings.HasPrefix(upper, "COM") {
		return `\\.\` + upper
	}
	return upper
}

func canonicalUnixDevice(device string) string {
	abs, err := filepath.Abs(device)
	if err != nil {
		abs = device
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return filepath.Clean(abs)
	}
	return filepath.Clean(resolved)
}

// CanonicalDevicePaths maps each path to its canonical form (best-effort).
func CanonicalDevicePaths(devices []string) []string {
	if len(devices) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(devices))
	seen := make(map[string]struct{}, len(devices))
	for _, device := range devices {
		canon := CanonicalDevicePath(device)
		if canon == "" {
			continue
		}
		if _, ok := seen[canon]; ok {
			continue
		}
		seen[canon] = struct{}{}
		out = append(out, canon)
	}
	return out
}
