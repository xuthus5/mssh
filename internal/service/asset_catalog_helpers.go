package service

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/model"
)

func normalizeAssetName(value string, limit int) (string, string, error) {
	name := strings.TrimSpace(value)
	if name == "" || utf8.RuneCountInString(name) > limit {
		return "", "", fmt.Errorf("asset name must contain 1-%d characters", limit)
	}
	if strings.ContainsRune(name, 0) {
		return "", "", fmt.Errorf("asset name contains NUL")
	}
	return name, strings.ToLower(name), nil
}

const maxAssetSortOrder = 1_000_000

func normalizeAssetSortOrder(value int) (int, error) {
	if value < 0 || value > maxAssetSortOrder {
		return 0, fmt.Errorf("sort order must be between 0 and %d", maxAssetSortOrder)
	}
	return value, nil
}

func normalizeProject(input model.AssetProjectInput) (string, string, string, any, string, error) {
	name, key, err := normalizeAssetName(input.Name, 64)
	if err != nil {
		return "", "", "", nil, "", err
	}
	code := strings.TrimSpace(input.Code)
	if strings.ContainsRune(code, 0) {
		return "", "", "", nil, "", fmt.Errorf("project code contains NUL")
	}
	if utf8.RuneCountInString(code) > 24 {
		return "", "", "", nil, "", fmt.Errorf("project code must not exceed 24 characters")
	}
	description := strings.TrimSpace(input.Description)
	if strings.ContainsRune(description, 0) {
		return "", "", "", nil, "", fmt.Errorf("project description contains NUL")
	}
	if utf8.RuneCountInString(description) > 500 {
		return "", "", "", nil, "", fmt.Errorf("project description must not exceed 500 characters")
	}
	var codeKey any
	if code != "" {
		codeKey = strings.ToLower(code)
	}
	return name, key, code, codeKey, description, nil
}

func validateAssetColor(token model.AssetColorToken) error {
	valid := map[model.AssetColorToken]struct{}{
		model.AssetColorSlate: {}, model.AssetColorRed: {}, model.AssetColorOrange: {}, model.AssetColorAmber: {},
		model.AssetColorYellow: {}, model.AssetColorLime: {}, model.AssetColorGreen: {}, model.AssetColorTeal: {},
		model.AssetColorCyan: {}, model.AssetColorBlue: {}, model.AssetColorViolet: {}, model.AssetColorPink: {},
	}
	if _, exists := valid[token]; !exists {
		return fmt.Errorf("invalid asset color token %q", token)
	}
	return nil
}

type assetScanner interface{ Scan(...any) error }

func scanEnvironment(scanner assetScanner) (model.AssetEnvironment, error) {
	var item model.AssetEnvironment
	var createdAt, updatedAt string
	if err := scanner.Scan(&item.ID, &item.Name, &item.ColorToken, &item.SortOrder, &item.SessionCount, &createdAt, &updatedAt); err != nil {
		return item, err
	}
	return item, parseCatalogTimes(createdAt, updatedAt, &item.CreatedAt, &item.UpdatedAt)
}

func scanProject(scanner assetScanner) (model.AssetProject, error) {
	var item model.AssetProject
	var createdAt, updatedAt string
	if err := scanner.Scan(&item.ID, &item.Name, &item.Code, &item.Description, &item.SortOrder, &item.SessionCount, &createdAt, &updatedAt); err != nil {
		return item, err
	}
	return item, parseCatalogTimes(createdAt, updatedAt, &item.CreatedAt, &item.UpdatedAt)
}

func scanTag(scanner assetScanner) (model.AssetTag, error) {
	var item model.AssetTag
	var createdAt, updatedAt string
	if err := scanner.Scan(&item.ID, &item.Name, &item.ColorToken, &item.SessionCount, &createdAt, &updatedAt); err != nil {
		return item, err
	}
	return item, parseCatalogTimes(createdAt, updatedAt, &item.CreatedAt, &item.UpdatedAt)
}

func parseCatalogTimes(createdAt, updatedAt string, created, updated *time.Time) error {
	var err error
	*created, err = time.Parse("2006-01-02 15:04:05", createdAt)
	if err != nil {
		return fmt.Errorf("parse asset created_at: %w", err)
	}
	*updated, err = time.Parse("2006-01-02 15:04:05", updatedAt)
	if err != nil {
		return fmt.Errorf("parse asset updated_at: %w", err)
	}
	return nil
}

func appendCatalogAudit(tx *sql.Tx, action, kind string, id int64, summary string) error {
	return appendAssetAudit(tx, model.AuditEvent{
		Action: action, TargetType: "asset_" + kind, TargetID: fmt.Sprint(id), Summary: summary, Outcome: "success",
	})
}
