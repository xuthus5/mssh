package serial

import (
	"fmt"
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

// ValidateDevicePath rejects empty, NUL-containing, or otherwise unsafe serial device paths.
func ValidateDevicePath(device string) (string, error) {
	device = strings.TrimSpace(device)
	if device == "" {
		return "", fmt.Errorf("serial device is required")
	}
	if strings.ContainsRune(device, 0) {
		return "", fmt.Errorf("serial device path contains NUL")
	}
	if len(device) > 4096 {
		return "", fmt.Errorf("serial device path is too long")
	}
	canonical := CanonicalDevicePath(device)
	if canonical == "" {
		return "", fmt.Errorf("serial device is required")
	}
	if runtime.GOOS == "windows" {
		if !isWindowsSerialDevice(canonical) {
			return "", fmt.Errorf("serial device must be a COM port")
		}
		return canonical, nil
	}
	if !filepath.IsAbs(canonical) {
		return "", fmt.Errorf("serial device path must be absolute")
	}
	if !isUnixSerialDevice(canonical) {
		return "", fmt.Errorf("serial device path is not under an allowed device prefix")
	}
	return canonical, nil
}

func isWindowsSerialDevice(device string) bool {
	upper := strings.ToUpper(device)
	if strings.HasPrefix(upper, `\\.\COM`) {
		suffix := upper[len(`\\.\COM`):]
		return isDigits(suffix)
	}
	if strings.HasPrefix(upper, "COM") {
		return isDigits(upper[3:])
	}
	return false
}

func isUnixSerialDevice(device string) bool {
	prefixes := []string{
		"/dev/tty", "/dev/cu.", "/dev/serial/", "/dev/pts/", "/dev/rfcomm",
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(device, prefix) {
			return true
		}
	}
	return false
}

func isDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
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
