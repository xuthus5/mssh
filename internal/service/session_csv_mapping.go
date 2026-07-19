package service

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/model"
)

const maxSessionCSVPreviewRows = 20

func (s *SessionService) PreviewCSV(path string) (model.SessionCSVPreview, error) {
	records, err := readSessionCSVRecords(path)
	if err != nil {
		return model.SessionCSVPreview{}, fmt.Errorf("preview session csv: %w", err)
	}
	preview := model.SessionCSVPreview{
		Headers:    normalizeSessionCSVHeaders(records[0]),
		SampleRows: make([][]string, 0, maxSessionCSVPreviewRows),
		TotalRows:  len(records) - 1,
	}
	for index, values := range records[1:] {
		if index >= maxSessionCSVPreviewRows {
			break
		}
		preview.SampleRows = append(preview.SampleRows, maskSessionCSVPreviewRow(preview.Headers, values))
	}
	return preview, nil
}

func readSessionCSVRecords(path string) ([][]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	content, err := io.ReadAll(io.LimitReader(file, maxSessionCSVBytes+1))
	if err != nil {
		return nil, err
	}
	if len(content) > maxSessionCSVBytes {
		return nil, fmt.Errorf("session csv exceeds %d bytes", maxSessionCSVBytes)
	}
	if !utf8.Valid(content) {
		return nil, errors.New("session csv is not valid UTF-8")
	}
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(content), "\ufeff")))
	records, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("parse csv: %w", err)
	}
	if len(records) == 0 {
		return nil, errors.New("csv is empty")
	}
	if len(records)-1 > maxSessionCSVRows {
		return nil, fmt.Errorf("session csv exceeds %d rows", maxSessionCSVRows)
	}
	return records, nil
}

func mapSessionCSVRecords(records [][]string, mapping, defaults map[string]string) ([][]string, error) {
	sourceColumns, err := sessionCSVSourceColumns(records[0])
	if err != nil {
		return nil, err
	}
	if err := validateSessionCSVMapping(mapping, sourceColumns); err != nil {
		return nil, err
	}
	resolvedDefaults := defaultSessionCSVImportValues()
	for target, value := range defaults {
		if !containsSessionCSVHeader(target) {
			return nil, fmt.Errorf("unsupported default csv column %q", target)
		}
		resolvedDefaults[target] = value
	}
	result := make([][]string, 0, len(records))
	result = append(result, append([]string{}, sessionCSVHeader...))
	for _, sourceValues := range records[1:] {
		result = append(result, mapSessionCSVRow(sourceValues, sourceColumns, mapping, resolvedDefaults))
	}
	return result, nil
}

func sessionCSVSourceColumns(header []string) (map[string]int, error) {
	headers := normalizeSessionCSVHeaders(header)
	columns := make(map[string]int, len(headers))
	for index, name := range headers {
		if name == "" {
			return nil, fmt.Errorf("csv header column %d is empty", index+1)
		}
		if _, exists := columns[name]; exists {
			return nil, fmt.Errorf("csv header contains duplicate column %q", name)
		}
		columns[name] = index
	}
	return columns, nil
}

func mapSessionCSVRow(values []string, columns map[string]int, mapping, defaults map[string]string) []string {
	result := make([]string, len(sessionCSVHeader))
	for index, target := range sessionCSVHeader {
		source := mapping[target]
		if source == "" {
			result[index] = defaults[target]
			continue
		}
		value := csvValueAt(values, columns[source])
		if strings.TrimSpace(value) == "" {
			value = defaults[target]
		}
		result[index] = value
	}
	return result
}

func defaultSessionCSVImportValues() map[string]string {
	return map[string]string{
		"format_version": sessionCSVVersion,
		"port":           "22",
		"auth_method":    string(model.AuthPassword),
		"folder_path":    "[]",
		"tags":           "[]",
		"keep_alive":     strconv.Itoa(DefaultKeepAliveSeconds),
		"term_type":      "xterm-256color",
	}
}

func validateSessionCSVMapping(mapping map[string]string, sourceColumns map[string]int) error {
	seenSources := make(map[string]string, len(mapping))
	for target, source := range mapping {
		if !containsSessionCSVHeader(target) {
			return fmt.Errorf("unsupported target csv column %q", target)
		}
		if source == "" {
			continue
		}
		if _, exists := sourceColumns[source]; !exists {
			return fmt.Errorf("source csv column %q was not found", source)
		}
		if previous, exists := seenSources[source]; exists {
			return fmt.Errorf("source csv column %q is mapped to both %q and %q", source, previous, target)
		}
		seenSources[source] = target
	}
	return nil
}

func normalizeSessionCSVHeaders(header []string) []string {
	normalized := make([]string, len(header))
	for index, name := range header {
		normalized[index] = strings.TrimSpace(strings.TrimPrefix(name, "\ufeff"))
	}
	return normalized
}

func containsSessionCSVHeader(target string) bool {
	for _, name := range sessionCSVHeader {
		if name == target {
			return true
		}
	}
	return false
}

func csvValueAt(values []string, index int) string {
	if index < 0 || index >= len(values) {
		return ""
	}
	return values[index]
}

func maskSessionCSVPreviewRow(headers, values []string) []string {
	masked := append([]string{}, values...)
	for index, header := range headers {
		if index < len(masked) && sensitiveSessionCSVHeader(header) {
			masked[index] = "******"
		}
	}
	return masked
}

func sensitiveSessionCSVHeader(header string) bool {
	key := strings.ToLower(strings.NewReplacer("_", "", " ", "", "-", "").Replace(header))
	return strings.Contains(key, "password") || strings.Contains(key, "passphrase") ||
		strings.Contains(key, "privatekey") || strings.Contains(key, "identityfile") ||
		key == "secret" || key == "pass" || key == "pwd"
}
