package service

import (
	"bufio"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	msshssh "github.com/xuthus5/mssh/internal/ssh"
)

func (s *SessionService) ListHostKeys() ([]model.HostKeyEntry, error) {
	path := filepath.Join(s.dataDir, "known_hosts")
	var entries []model.HostKeyEntry
	err := msshssh.WithKnownHostsLock(func() error {
		var listErr error
		entries, listErr = s.listHostKeysLocked(path)
		return listErr
	})
	return entries, err
}

func (s *SessionService) listHostKeysLocked(path string) ([]model.HostKeyEntry, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return []model.HostKeyEntry{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("open known_hosts: %w", err)
	}
	defer func() { _ = file.Close() }()
	entries := make([]model.HostKeyEntry, 0)
	scanner := bufio.NewScanner(file)
	// Bound line size so a corrupt known_hosts cannot exhaust memory.
	scanner.Buffer(make([]byte, 64*1024), 64*1024)
	for line := 1; scanner.Scan(); line++ {
		if entry, ok := parseKnownHostLine(line, scanner.Text()); ok {
			entries = append(entries, entry)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read known_hosts: %w", err)
	}
	return entries, nil
}

func parseKnownHostLine(line int, value string) (model.HostKeyEntry, bool) {
	fields := strings.Fields(value)
	if len(fields) < 3 || strings.HasPrefix(strings.TrimSpace(value), "#") {
		return model.HostKeyEntry{}, false
	}
	offset := 0
	if strings.HasPrefix(fields[0], "@") {
		if len(fields) < 4 {
			return model.HostKeyEntry{}, false
		}
		offset = 1
	}
	encoded, err := base64.StdEncoding.DecodeString(fields[offset+2])
	if err != nil {
		return model.HostKeyEntry{}, false
	}
	key, err := gossh.ParsePublicKey(encoded)
	if err != nil {
		return model.HostKeyEntry{}, false
	}
	return model.HostKeyEntry{Line: line, Hosts: fields[offset], Algorithm: fields[offset+1], Fingerprint: gossh.FingerprintSHA256(key)}, true
}

func (s *SessionService) DeleteHostKey(line int) error {
	if line < 1 {
		return errors.New("known_hosts line must be positive")
	}
	path := filepath.Join(s.dataDir, "known_hosts")
	return msshssh.WithKnownHostsLock(func() error {
		return s.deleteHostKeyLocked(path, line)
	})
}

func (s *SessionService) deleteHostKeyLocked(path string, line int) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read known_hosts: %w", err)
	}
	lines := strings.Split(string(content), "\n")
	if line > len(lines) || strings.TrimSpace(lines[line-1]) == "" {
		return fmt.Errorf("known_hosts line %d not found", line)
	}
	lines = append(lines[:line-1], lines[line:]...)
	temporary, err := os.CreateTemp(s.dataDir, "known_hosts-*.tmp")
	if err != nil {
		return fmt.Errorf("create known_hosts temp file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() { _ = os.Remove(temporaryPath) }()
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("secure known_hosts temp file: %w", err)
	}
	if _, err := temporary.WriteString(strings.Join(lines, "\n")); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write known_hosts: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync known_hosts temp file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close known_hosts temp file: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace known_hosts: %w", err)
	}
	return nil
}
