package applog

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	DefaultRetentionDays = 30
	MinRetentionDays     = 1
	MaxRetentionDays     = 3650
	logFileLayout        = "2006-01-02"
	logFileSuffix        = ".log"
)

// Manager writes structured logs to stderr and a daily file under a configurable directory.
type Manager struct {
	mu        sync.Mutex
	dir       string
	retention int
	file      *os.File
	day       string
	stderr    io.Writer
	now       func() time.Time
}

// Options configures a log manager.
type Options struct {
	Dir           string
	RetentionDays int
	Stderr        io.Writer
	Now           func() time.Time
}

// New creates a manager with validated defaults. Call Configure/Open before first file write.
func New(opts Options) *Manager {
	manager := &Manager{
		dir:       strings.TrimSpace(opts.Dir),
		retention: NormalizeRetentionDays(opts.RetentionDays),
		stderr:    opts.Stderr,
		now:       opts.Now,
	}
	if manager.stderr == nil {
		manager.stderr = os.Stderr
	}
	if manager.now == nil {
		manager.now = time.Now
	}
	return manager
}

// DefaultDir returns ~/.mssh/logs (or .mssh/logs when home is unavailable).
func DefaultDir() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return filepath.Join(".mssh", "logs")
	}
	return filepath.Join(home, ".mssh", "logs")
}

// NormalizeDir returns the configured directory or the product default when empty.
// Non-empty values are filepath.Clean'ed; call ValidateDir before persisting user input.
func NormalizeDir(dir string) string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return DefaultDir()
	}
	return filepath.Clean(dir)
}

// ValidateDir validates a user-supplied log directory.
// Empty input resolves to DefaultDir. Rejects NUL bytes, oversized paths, and cleaned "." / "..".
func ValidateDir(dir string) (string, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return DefaultDir(), nil
	}
	if strings.ContainsRune(dir, 0) {
		return "", fmt.Errorf("log directory contains NUL")
	}
	if len(dir) > 4096 {
		return "", fmt.Errorf("log directory path is too long")
	}
	cleaned := filepath.Clean(dir)
	if cleaned == "." || cleaned == ".." {
		return "", fmt.Errorf("log directory is invalid")
	}
	return cleaned, nil
}

// NormalizeRetentionDays clamps retention into the supported range.
func NormalizeRetentionDays(days int) int {
	if days < MinRetentionDays {
		return DefaultRetentionDays
	}
	if days > MaxRetentionDays {
		return MaxRetentionDays
	}
	return days
}

// Configure updates directory and retention, reopening the active file when needed.
func (m *Manager) Configure(dir string, retentionDays int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	validated, err := ValidateDir(dir)
	if err != nil {
		return err
	}
	m.dir = validated
	m.retention = NormalizeRetentionDays(retentionDays)
	if err := m.ensureFileLocked(); err != nil {
		return err
	}
	m.purgeLocked()
	return nil
}

// Dir returns the active log directory.
func (m *Manager) Dir() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return NormalizeDir(m.dir)
}

// RetentionDays returns the active retention window.
func (m *Manager) RetentionDays() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return NormalizeRetentionDays(m.retention)
}

// Handler returns a text handler writing to stderr and the daily log file.
func (m *Manager) Handler() slog.Handler {
	return slog.NewTextHandler(io.MultiWriter(m.stderr, m), &slog.HandlerOptions{Level: slog.LevelInfo})
}

// Write implements io.Writer for slog and ensures the correct daily file is open.
func (m *Manager) Write(payload []byte) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.ensureFileLocked(); err != nil {
		return 0, err
	}
	return m.file.Write(payload)
}

// Close closes the active log file.
func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.closeFileLocked()
}

func (m *Manager) ensureFileLocked() error {
	day := m.now().Local().Format(logFileLayout)
	dir := NormalizeDir(m.dir)
	if m.file != nil && m.day == day && m.dir == dir {
		return nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create log directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("chmod log directory: %w", err)
	}
	if err := m.closeFileLocked(); err != nil {
		return err
	}
	path := filepath.Join(dir, day+logFileSuffix)
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return fmt.Errorf("chmod log file: %w", err)
	}
	m.file = file
	m.day = day
	m.dir = dir
	m.purgeLocked()
	return nil
}

func (m *Manager) closeFileLocked() error {
	if m.file == nil {
		return nil
	}
	err := m.file.Close()
	m.file = nil
	m.day = ""
	return err
}

func (m *Manager) purgeLocked() {
	dir := NormalizeDir(m.dir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	// Keep the most recent retention days including today; delete files on or before cutoff.
	nowLocal := m.now().Local()
	today := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, nowLocal.Location())
	cutoff := today.AddDate(0, 0, -NormalizeRetentionDays(m.retention))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, logFileSuffix) {
			continue
		}
		dayName := strings.TrimSuffix(name, logFileSuffix)
		parsed, parseErr := time.ParseInLocation(logFileLayout, dayName, nowLocal.Location())
		if parseErr != nil {
			continue
		}
		if !parsed.After(cutoff) {
			_ = os.Remove(filepath.Join(dir, name))
		}
	}
}
