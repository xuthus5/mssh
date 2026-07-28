package ssh

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/xuthus5/mssh/internal/fsutil"
)

// ErrEmptyKnownHostsPath is returned when host key verification is required
// but no known_hosts path was provided.
var ErrEmptyKnownHostsPath = errors.New("known_hosts path is required for host key verification")

var (
	knownHostsMu      sync.Mutex
	hostKeyDecisionMu sync.Mutex
)

type hostKeyCheck struct {
	callback       gossh.HostKeyCallback
	hostname       string
	remote         net.Addr
	key            gossh.PublicKey
	knownHostsPath string
	onNewHostKey   HostKeyVerifyFunc
	logger         *slog.Logger
}

// WithKnownHostsLock runs fn while holding the process-wide known_hosts write lock.
// Use for any read-modify-write of the known_hosts file (accept TOFU, delete fingerprint).
func WithKnownHostsLock(fn func() error) error {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	return fn()
}

func createHostKeyCallback(knownHostsPath string, onNewHostKey HostKeyVerifyFunc, logger *slog.Logger) (gossh.HostKeyCallback, error) {
	if strings.TrimSpace(knownHostsPath) == "" {
		return nil, ErrEmptyKnownHostsPath
	}
	if err := ensureKnownHostsFile(knownHostsPath); err != nil {
		return nil, err
	}
	baseCallback, err := loadKnownHostsCallback(knownHostsPath)
	if err != nil {
		return nil, err
	}
	return func(hostname string, remote net.Addr, key gossh.PublicKey) error {
		return verifyHostKey(hostKeyCheck{
			callback:       baseCallback,
			hostname:       hostname,
			remote:         remote,
			key:            key,
			knownHostsPath: knownHostsPath,
			onNewHostKey:   onNewHostKey,
			logger:         logger,
		})
	}, nil
}

func ensureKnownHostsFile(knownHostsPath string) error {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	if err := secureKnownHostsFile(knownHostsPath); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(knownHostsPath), 0o700); err != nil {
		return fmt.Errorf("create known_hosts dir: %w", err)
	}
	file, _, err := fsutil.CreateRegularFileForAppend(knownHostsPath, 0o600)
	if errors.Is(err, os.ErrExist) {
		return secureKnownHostsFile(knownHostsPath)
	}
	if err != nil {
		return fmt.Errorf("create known_hosts: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close known_hosts: %w", err)
	}
	return nil
}

func verifyHostKey(check hostKeyCheck) error {
	err := check.callback(check.hostname, check.remote, check.key)
	if err == nil {
		return nil
	}
	var keyErr *knownhosts.KeyError
	if !errors.As(err, &keyErr) {
		return err
	}
	if len(keyErr.Want) != 0 {
		return hostKeyChangedError(check.hostname, check.key, keyErr)
	}
	return handleNewHostKey(check)
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

func handleNewHostKey(check hostKeyCheck) error {
	hostKeyDecisionMu.Lock()
	defer hostKeyDecisionMu.Unlock()
	trusted, err := hostKeyAlreadyTrusted(check)
	if err != nil {
		return err
	}
	if trusted {
		return nil
	}
	algorithm := check.key.Type()
	fingerprint := gossh.FingerprintSHA256(check.key)
	if check.logger != nil {
		check.logger.Info("first-seen host key observed", "hostname", check.hostname, "algorithm", algorithm, "fingerprint", fingerprint)
	}
	if check.onNewHostKey != nil && !check.onNewHostKey(check.hostname, algorithm, fingerprint) {
		return fmt.Errorf("host key rejected by user: %s", check.hostname)
	}
	return appendKnownHostIfUnknown(check)
}

func hostKeyAlreadyTrusted(check hostKeyCheck) (bool, error) {
	verifyErr := verifyCurrentHostKey(check)
	if verifyErr == nil {
		return true, nil
	}
	if err := validateUnknownHostKeyError(check.hostname, check.key, verifyErr); err != nil {
		return false, err
	}
	return false, nil
}

func verifyCurrentHostKey(check hostKeyCheck) error {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	callback, err := loadKnownHostsCallback(check.knownHostsPath)
	if err != nil {
		return err
	}
	return callback(check.hostname, check.remote, check.key)
}

func validateUnknownHostKeyError(hostname string, presented gossh.PublicKey, err error) error {
	var keyErr *knownhosts.KeyError
	if !errors.As(err, &keyErr) {
		return err
	}
	if len(keyErr.Want) == 0 {
		return nil
	}
	return hostKeyChangedError(hostname, presented, keyErr)
}

func appendKnownHostIfUnknown(check hostKeyCheck) error {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	callback, err := loadKnownHostsCallback(check.knownHostsPath)
	if err != nil {
		return err
	}
	verifyErr := callback(check.hostname, check.remote, check.key)
	if verifyErr == nil {
		return nil
	}
	if err := validateUnknownHostKeyError(check.hostname, check.key, verifyErr); err != nil {
		return err
	}
	return appendKnownHostLocked(check.knownHostsPath, check.hostname, check.key)
}

func appendKnownHost(knownHostsPath, hostname string, key gossh.PublicKey) error {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	return appendKnownHostLocked(knownHostsPath, hostname, key)
}

func appendKnownHostLocked(knownHostsPath, hostname string, key gossh.PublicKey) (resultErr error) {
	entry := knownhosts.Line([]string{hostname}, key)
	file, err := openKnownHostsAppendFile(knownHostsPath, int64(len(entry)+1))
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("close known_hosts: %w", closeErr))
		}
	}()
	if _, err := fmt.Fprintln(file, entry); err != nil {
		return fmt.Errorf("write known_hosts: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync known_hosts: %w", err)
	}
	return nil
}

func loadKnownHostsCallback(path string) (gossh.HostKeyCallback, error) {
	if err := secureKnownHostsFile(path); err != nil {
		return nil, err
	}
	callback, err := knownhosts.New(path)
	if err != nil {
		return nil, fmt.Errorf("parse known_hosts: %w", err)
	}
	return callback, nil
}

func secureKnownHostsFile(path string) error {
	file, err := openKnownHostsFile(path)
	if err != nil {
		return err
	}
	chmodErr := file.Chmod(0o600)
	closeErr := file.Close()
	if chmodErr != nil || closeErr != nil {
		return fmt.Errorf("secure known_hosts: %w", errors.Join(chmodErr, closeErr))
	}
	return nil
}

func openKnownHostsAppendFile(path string, additionalBytes int64) (*os.File, error) {
	file, info, err := fsutil.OpenRegularFileForAppend(path)
	if errors.Is(err, os.ErrNotExist) {
		return createKnownHostsAppendFile(path, additionalBytes)
	}
	if err != nil {
		return nil, fmt.Errorf("open known_hosts: %w", err)
	}
	if additionalBytes > maxKnownHostsFileBytes-info.Size() {
		return nil, closeKnownHostsWithError(file, knownHostsTooLargeError())
	}
	if err := file.Chmod(0o600); err != nil {
		return nil, closeKnownHostsWithError(file, fmt.Errorf("secure known_hosts: %w", err))
	}
	return file, nil
}

func createKnownHostsAppendFile(path string, additionalBytes int64) (*os.File, error) {
	if additionalBytes > maxKnownHostsFileBytes {
		return nil, knownHostsTooLargeError()
	}
	file, _, err := fsutil.CreateRegularFileForAppend(path, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create known_hosts: %w", err)
	}
	return file, nil
}
