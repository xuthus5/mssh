package ssh

import (
	"fmt"
	"strings"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/xuthus5/mssh/internal/fsutil"
)

// handleChangedHostKey applies the host key change policy when a known host
// presents a different fingerprint than previously trusted.
func handleChangedHostKey(check hostKeyCheck, keyErr *knownhosts.KeyError) error {
	switch check.policy {
	case HostKeyPolicyTrust:
		return replaceHostKey(check, keyErr)
	case HostKeyPolicyWarn:
		if check.onHostKeyChange != nil {
			accepted := check.onHostKeyChange(check.hostname, check.key.Type(), gossh.FingerprintSHA256(check.key), expectedHostKeyFingerprints(keyErr))
			if !accepted {
				return fmt.Errorf("host key change rejected by user: %s", check.hostname)
			}
		}
		return replaceHostKey(check, keyErr)
	default:
		return hostKeyChangedError(check.hostname, check.key, keyErr)
	}
}

func hostKeyChangedError(hostname string, presented gossh.PublicKey, keyErr *knownhosts.KeyError) error {
	presentedFingerprint := gossh.FingerprintSHA256(presented)
	expected := expectedHostKeyFingerprints(keyErr)
	if len(expected) == 0 {
		return fmt.Errorf("host key for %s changed (presented %s %s); connection blocked. remove the old fingerprint in Security settings if the change is expected",
			hostname, presented.Type(), presentedFingerprint)
	}
	return fmt.Errorf("host key for %s changed (possible MITM). expected [%s]; presented %s %s. connection blocked. remove the old fingerprint in Security settings if the change is expected",
		hostname, strings.Join(expected, ", "), presented.Type(), presentedFingerprint)
}

func expectedHostKeyFingerprints(keyErr *knownhosts.KeyError) []string {
	expected := make([]string, 0, len(keyErr.Want))
	for _, known := range keyErr.Want {
		if known.Key != nil {
			expected = append(expected, known.Key.Type()+" "+gossh.FingerprintSHA256(known.Key))
		}
	}
	return expected
}

// replaceHostKey replaces the stored fingerprint for the host with the newly
// presented key by removing old matching lines and appending the new one.
func replaceHostKey(check hostKeyCheck, keyErr *knownhosts.KeyError) error {
	if check.logger != nil {
		check.logger.Info("replacing host key", "hostname", check.hostname, "algorithm", check.key.Type())
	}
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	content, err := ReadKnownHostsFile(check.knownHostsPath)
	if err != nil {
		return err
	}
	lines := strings.Split(string(content), "\n")
	kept := make([]string, 0, len(lines))
	target := knownhosts.Normalize(check.hostname)
	removeLines := hostKeyReplacementLines(keyErr, check.key.Type())
	for index, line := range lines {
		lineNumber := index + 1
		if removeLines[lineNumber] || (len(removeLines) == 0 && knownHostLineForHost(line, target)) {
			continue
		}
		kept = append(kept, line)
	}
	entry := knownhosts.Line([]string{check.hostname}, check.key)
	kept = append(kept, entry)
	if err := writeKnownHostsLocked(check.knownHostsPath, kept); err != nil {
		return fmt.Errorf("replace known_hosts: %w", err)
	}
	return nil
}

func hostKeyReplacementLines(keyErr *knownhosts.KeyError, keyType string) map[int]bool {
	lines := make(map[int]bool)
	if keyErr == nil {
		return lines
	}
	for _, known := range keyErr.Want {
		if known.Key != nil && known.Key.Type() == keyType && known.Line > 0 {
			lines[known.Line] = true
		}
	}
	return lines
}

// knownHostLineForHost reports whether a known_hosts line is addressed to the
// normalized target host. Hashed and marker lines are never considered a match.
func knownHostLineForHost(line, target string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return false
	}
	fields := strings.Fields(trimmed)
	if len(fields) < 3 {
		return false
	}
	hostField := fields[0]
	if strings.HasPrefix(hostField, "@") || strings.HasPrefix(hostField, "|") {
		return false
	}
	for _, host := range strings.Split(hostField, ",") {
		if knownhosts.Normalize(host) == target {
			return true
		}
	}
	return false
}

// writeKnownHostsLocked atomically rewrites the known_hosts file with the given
// lines, enforcing the size bound and 0600 permissions.
func writeKnownHostsLocked(path string, lines []string) error {
	content := []byte(strings.Join(lines, "\n"))
	if int64(len(content)) > maxKnownHostsFileBytes {
		return knownHostsTooLargeError()
	}
	if err := fsutil.WritePrivateFileAtomic(path, content, "known_hosts-*.tmp"); err != nil {
		return err
	}
	return nil
}
