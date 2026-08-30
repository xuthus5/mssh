//go:build !linux

package crypto

// keychainPlatformAvailable is true on platforms where go-keyring does not
// depend on the Linux Secret Service (macOS Keychain, Windows Credential
// Manager, BSD fallbacks).
func keychainPlatformAvailable() bool { return true }
