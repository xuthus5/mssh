package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/model"
)

type parsedSessionCSVRow struct {
	Record sessionCSVRecord
	Error  error
}

func (s *SessionService) ImportCSV(path string, options model.SessionCSVImportOptions) (model.SessionCSVImportSummary, error) {
	summary := model.SessionCSVImportSummary{Results: []model.SessionCSVImportResult{}}
	cleaned, pathErr := validateLocalFilePath(path)
	if pathErr != nil {
		return summary, fmt.Errorf("import session csv: %w", pathErr)
	}
	path = cleaned
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{
			Action: "import", TargetType: "session_csv",
			Summary: fmt.Sprintf("导入 SSH 会话：新增 %d，更新 %d，跳过 %d，失败 %d", summary.Imported, summary.Updated, summary.Skipped, summary.Failed),
			Outcome: outcome,
		})
	}()
	if err := validateSessionCSVConflictPolicy(options.ConflictPolicy); err != nil {
		return summary, fmt.Errorf("import session csv: %w", err)
	}
	rows, err := readSessionCSV(path, options)
	if err != nil {
		return summary, fmt.Errorf("import session csv: %w", err)
	}
	summary.Total = len(rows)
	summary.Results = make([]model.SessionCSVImportResult, 0, len(rows))
	for _, row := range rows {
		result := s.importParsedSessionCSVRow(row, options.ConflictPolicy)
		summary.Results = append(summary.Results, result)
		addSessionCSVResult(&summary, result.Status)
	}
	if summary.Failed == 0 {
		outcome = "success"
	}
	s.logger.Info("imported session csv", "total", summary.Total, "imported", summary.Imported, "updated", summary.Updated, "skipped", summary.Skipped, "failed", summary.Failed)
	return summary, nil
}

func (s *SessionService) importParsedSessionCSVRow(row parsedSessionCSVRow, policy model.SessionCSVConflictPolicy) model.SessionCSVImportResult {
	result := model.SessionCSVImportResult{Row: row.Record.Row, Name: row.Record.Name, Host: row.Record.Host, Status: "failed"}
	if row.Error != nil {
		result.Error = row.Error.Error()
		return result
	}
	status, sessionID, err := s.importSessionCSVRecord(row.Record, policy)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Status = status
	result.SessionID = sessionID
	return result
}

func addSessionCSVResult(summary *model.SessionCSVImportSummary, status string) {
	switch status {
	case "imported":
		summary.Imported++
	case "updated":
		summary.Updated++
	case "skipped":
		summary.Skipped++
	default:
		summary.Failed++
	}
}

func validateSessionCSVConflictPolicy(policy model.SessionCSVConflictPolicy) error {
	if policy != model.SessionCSVConflictSkip && policy != model.SessionCSVConflictOverwrite {
		return fmt.Errorf("unsupported conflict policy %q", policy)
	}
	return nil
}

func readSessionCSV(path string, options model.SessionCSVImportOptions) ([]parsedSessionCSVRow, error) {
	records, err := readSessionCSVRecords(path)
	if err != nil {
		return nil, err
	}
	if len(options.HeaderMapping) > 0 || len(options.DefaultValues) > 0 {
		records, err = mapSessionCSVRecords(records, options.HeaderMapping, options.DefaultValues)
		if err != nil {
			return nil, err
		}
	}
	columns, err := sessionCSVColumns(records[0])
	if err != nil {
		return nil, err
	}
	rows := make([]parsedSessionCSVRow, 0, len(records)-1)
	for index, values := range records[1:] {
		record, parseErr := parseSessionCSVRecord(index+2, columns, values)
		rows = append(rows, parsedSessionCSVRow{Record: record, Error: parseErr})
	}
	return rows, nil
}

func sessionCSVColumns(header []string) (map[string]int, error) {
	columns := make(map[string]int, len(header))
	for index, name := range header {
		name = strings.TrimSpace(strings.TrimPrefix(name, "\ufeff"))
		if name == "" {
			return nil, fmt.Errorf("csv header column %d is empty", index+1)
		}
		if _, exists := columns[name]; exists {
			return nil, fmt.Errorf("csv header contains duplicate column %q", name)
		}
		columns[name] = index
	}
	for _, name := range sessionCSVHeader {
		if _, exists := columns[name]; !exists {
			return nil, fmt.Errorf("csv header is missing %q", name)
		}
	}
	return columns, nil
}

func parseSessionCSVRecord(row int, columns map[string]int, values []string) (sessionCSVRecord, error) {
	record := sessionCSVRecord{Row: row}
	value := func(name string) string {
		index := columns[name]
		if index >= len(values) {
			return ""
		}
		return restoreCSVCell(values[index])
	}
	record.Name = strings.TrimSpace(value("name"))
	record.Host = strings.TrimSpace(value("host"))
	record.Username = strings.TrimSpace(value("username"))
	record.AuthMethod = normalizeSessionCSVAuthMethod(value("auth_method"))
	record.Password = value("password")
	record.KeyName = strings.TrimSpace(value("key_name"))
	record.KeyPublicKey = strings.TrimSpace(value("key_public_key"))
	record.Environment = strings.TrimSpace(value("environment"))
	record.Project = strings.TrimSpace(value("project"))
	record.Notes = value("notes")
	record.TermType = strings.TrimSpace(value("term_type"))
	var err error
	if value("format_version") != sessionCSVVersion {
		err = fmt.Errorf("row %d format_version must be %s", row, sessionCSVVersion)
	} else if record.Port, err = parseSessionCSVInteger("port", value("port"), 1, 65535); err == nil {
		record.KeepAlive, err = parseSessionCSVInteger("keep_alive", value("keep_alive"), 0, 86400)
	}
	if err != nil {
		return record, fmt.Errorf("row %d: %w", row, err)
	}
	if record.FolderPath, err = parseSessionCSVList(value("folder_path"), "/\\"); err != nil {
		return record, fmt.Errorf("row %d: invalid folder_path: %w", row, err)
	}
	if record.Tags, err = parseSessionCSVList(value("tags"), ",;|"); err != nil {
		return record, fmt.Errorf("row %d: invalid tags: %w", row, err)
	}
	if err := validateSessionCSVRecord(record); err != nil {
		return record, fmt.Errorf("row %d: %w", row, err)
	}
	return record, nil
}

func parseSessionCSVList(value, separators string) ([]string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return []string{}, nil
	}
	var result []string
	if strings.HasPrefix(value, "[") {
		if err := json.Unmarshal([]byte(value), &result); err != nil {
			return nil, err
		}
		return result, nil
	}
	result = strings.FieldsFunc(value, func(char rune) bool { return strings.ContainsRune(separators, char) })
	for index := range result {
		result[index] = strings.TrimSpace(result[index])
	}
	return result, nil
}

func normalizeSessionCSVAuthMethod(value string) model.AuthMethod {
	normalized := strings.ToLower(strings.NewReplacer("_", " ", "-", " ").Replace(strings.TrimSpace(value)))
	switch normalized {
	case "password", "pass", "pwd":
		return model.AuthPassword
	case "key", "public key", "private key", "publickey":
		return model.AuthKey
	case "agent", "ssh agent":
		return model.AuthAgent
	case "keyboard interactive", "keyboardinteractive":
		return model.AuthKeyboardInteractive
	default:
		return model.AuthMethod(strings.TrimSpace(value))
	}
}

func parseSessionCSVInteger(name, value string, minimum, maximum int) (int, error) {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer", name)
	}
	if parsed < minimum || parsed > maximum {
		return 0, fmt.Errorf("%s must be between %d and %d", name, minimum, maximum)
	}
	return parsed, nil
}

func validateSessionCSVRecord(record sessionCSVRecord) error {
	if err := validateSessionCSVText("name", record.Name, 1, 128); err != nil {
		return err
	}
	if err := validateSessionCSVText("host", record.Host, 1, 255); err != nil {
		return err
	}
	if err := validateSessionCSVText("username", record.Username, 1, 128); err != nil {
		return err
	}
	if err := validateSessionCSVText("term_type", record.TermType, 1, 64); err != nil {
		return err
	}
	if utf8.RuneCountInString(record.Notes) > sessionNotesLimit {
		return fmt.Errorf("notes must not exceed %d characters", sessionNotesLimit)
	}
	if len(record.FolderPath) > 32 || len(record.Tags) > 64 {
		return errors.New("folder_path or tags contains too many items")
	}
	if err := validateSessionCSVAuth(record.AuthMethod); err != nil {
		return err
	}
	return validateSessionCSVNames(record)
}

func validateSessionCSVText(name, value string, minimum, maximum int) error {
	length := utf8.RuneCountInString(value)
	if length < minimum || length > maximum {
		return fmt.Errorf("%s must contain between %d and %d characters", name, minimum, maximum)
	}
	return nil
}

func validateSessionCSVAuth(method model.AuthMethod) error {
	switch method {
	case model.AuthPassword, model.AuthKey, model.AuthAgent, model.AuthKeyboardInteractive:
		return nil
	default:
		return fmt.Errorf("unsupported auth_method %q", method)
	}
}

func validateSessionCSVNames(record sessionCSVRecord) error {
	for _, folder := range record.FolderPath {
		if err := validateSessionCSVText("folder name", strings.TrimSpace(folder), 1, 128); err != nil {
			return err
		}
	}
	for _, tag := range record.Tags {
		if _, _, err := normalizeAssetName(tag, 32); err != nil {
			return fmt.Errorf("tag: %w", err)
		}
	}
	if record.Environment != "" {
		if _, _, err := normalizeAssetName(record.Environment, 64); err != nil {
			return fmt.Errorf("environment: %w", err)
		}
	}
	if record.Project != "" {
		if _, _, err := normalizeAssetName(record.Project, 64); err != nil {
			return fmt.Errorf("project: %w", err)
		}
	}
	return nil
}
