package ssh

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func loadKnownHostsIgnoringInvalidLines(path string) (callback gossh.HostKeyCallback, invalid []int, resultErr error) {
	content, err := ReadKnownHostsFile(path)
	if err != nil {
		return nil, nil, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".known_hosts-validate-*")
	if err != nil {
		return nil, nil, fmt.Errorf("create known_hosts validation file: %w", err)
	}
	temporaryPath := temporary.Name()
	if err := errors.Join(temporary.Chmod(0o600), temporary.Close()); err != nil {
		_ = os.Remove(temporaryPath)
		return nil, nil, fmt.Errorf("prepare known_hosts validation file: %w", err)
	}
	defer func() {
		if err := os.Remove(temporaryPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			resultErr = errors.Join(resultErr, fmt.Errorf("remove known_hosts validation file: %w", err))
		}
	}()
	validLines, invalidLines, err := filterKnownHostsLines(temporaryPath, strings.Split(string(content), "\n"))
	if err != nil {
		return nil, nil, err
	}
	if err := os.WriteFile(temporaryPath, []byte(strings.Join(validLines, "\n")), 0o600); err != nil {
		return nil, nil, fmt.Errorf("write sanitized known_hosts: %w", err)
	}
	callback, err = knownhosts.New(temporaryPath)
	if err != nil {
		return nil, nil, fmt.Errorf("parse sanitized known_hosts: %w", err)
	}
	return callback, invalidLines, nil
}

func filterKnownHostsLines(temporaryPath string, lines []string) ([]string, []int, error) {
	valid := make([]string, 0, len(lines))
	invalid := make([]int, 0)
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			valid = append(valid, line)
			continue
		}
		if err := os.WriteFile(temporaryPath, []byte(line+"\n"), 0o600); err != nil {
			return nil, nil, fmt.Errorf("validate known_hosts line %d: %w", index+1, err)
		}
		if _, err := knownhosts.New(temporaryPath); err != nil {
			invalid = append(invalid, index+1)
			continue
		}
		valid = append(valid, line)
	}
	return valid, invalid, nil
}
