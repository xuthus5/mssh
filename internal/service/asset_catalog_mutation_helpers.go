package service

import (
	"database/sql"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

func (s *AssetCatalogService) deleteAssignableAsset(table, column, targetType string, input model.AssetDeleteInput) error {
	if input.ID <= 0 {
		return fmt.Errorf("invalid %s id", targetType)
	}
	if input.Mode != "migrate" && input.Mode != "clear" {
		return fmt.Errorf("invalid delete mode %q", input.Mode)
	}
	if input.Mode == "migrate" && (input.ReplacementID == nil || *input.ReplacementID == input.ID) {
		return fmt.Errorf("valid replacement is required")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	impact, err := assignableDeleteImpactTx(tx, table, column, input.ID)
	if err != nil {
		return err
	}
	if input.Mode == "migrate" {
		if err := ensureIDExists(tx, table, *input.ReplacementID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec("UPDATE sessions SET "+column+"=? WHERE "+column+"=?", input.ReplacementID, input.ID); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM "+table+" WHERE id=?", input.ID); err != nil {
		return err
	}
	summary := fmt.Sprintf("删除%s %s，处理 %d 个会话", targetType, impact.Name, impact.SessionCount)
	if err := appendAssetAudit(tx, model.AuditEvent{Action: "delete", TargetType: "asset_" + targetType, TargetID: fmt.Sprint(input.ID), Summary: summary, Outcome: "success"}); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *AssetCatalogService) bulkSetAsset(column, table, action string, input model.BulkAssetAssignmentInput) (int, error) {
	ids, err := normalizedIDs(input.SessionIDs)
	if err != nil {
		return 0, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := ensureIDsExist(tx, "sessions", ids); err != nil {
		return 0, err
	}
	if input.TargetID != nil {
		if err := ensureIDExists(tx, table, *input.TargetID); err != nil {
			return 0, err
		}
	}
	query, arguments := updateIDsQuery("UPDATE sessions SET "+column+"=? WHERE id IN (", input.TargetID, ids)
	if _, err := tx.Exec(query, arguments...); err != nil {
		return 0, err
	}
	if err := appendAssetAudit(tx, model.AuditEvent{Action: action, TargetType: "session", Summary: fmt.Sprintf("批量设置资产，影响 %d 个会话", len(ids)), Outcome: "success"}); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(ids), nil
}

func (s *AssetCatalogService) reorderAssets(table, kind string, ids []int64) error {
	normalized, err := normalizedIDs(ids)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := ensureIDsExist(tx, table, normalized); err != nil {
		return err
	}
	var total int
	if err := tx.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&total); err != nil {
		return err
	}
	if total != len(normalized) {
		return fmt.Errorf("reorder %s requires all catalog ids", kind)
	}
	for index, id := range normalized {
		if _, err := tx.Exec("UPDATE "+table+" SET sort_order=?, updated_at=datetime('now') WHERE id=?", index, id); err != nil {
			return err
		}
	}
	if err := appendCatalogAudit(tx, "reorder", kind, 0, fmt.Sprintf("调整%s排序，共 %d 项", kind, len(normalized))); err != nil {
		return err
	}
	return tx.Commit()
}

func assetDeleteImpact(db *sql.DB, table, column string, id int64) (*model.AssetDeleteImpact, error) {
	var impact model.AssetDeleteImpact
	err := db.QueryRow("SELECT a.id, a.name, COUNT(s.id) FROM "+table+" a LEFT JOIN sessions s ON s."+column+"=a.id WHERE a.id=? GROUP BY a.id", id).Scan(&impact.ID, &impact.Name, &impact.SessionCount)
	if err != nil {
		return nil, err
	}
	return &impact, nil
}

func assignableDeleteImpactTx(tx *sql.Tx, table, column string, id int64) (*model.AssetDeleteImpact, error) {
	var impact model.AssetDeleteImpact
	err := tx.QueryRow("SELECT a.id, a.name, COUNT(s.id) FROM "+table+" a LEFT JOIN sessions s ON s."+column+"=a.id WHERE a.id=? GROUP BY a.id", id).Scan(&impact.ID, &impact.Name, &impact.SessionCount)
	return &impact, err
}

func tagDeleteImpactTx(tx *sql.Tx, id int64) (*model.AssetDeleteImpact, error) {
	var impact model.AssetDeleteImpact
	err := tx.QueryRow(`SELECT t.id, t.name, COUNT(st.session_id) FROM asset_tags t LEFT JOIN session_tags st ON st.tag_id=t.id WHERE t.id=? GROUP BY t.id`, id).Scan(&impact.ID, &impact.Name, &impact.SessionCount)
	return &impact, err
}

func normalizedIDs(values []int64) ([]int64, error) {
	result, err := normalizedIDsAllowEmpty(values)
	if err != nil {
		return nil, err
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("at least one id is required")
	}
	return result, nil
}

func normalizedIDsAllowEmpty(values []int64) ([]int64, error) {
	seen := make(map[int64]struct{}, len(values))
	result := make([]int64, 0, len(values))
	for _, value := range values {
		if value <= 0 {
			return nil, fmt.Errorf("invalid id %d", value)
		}
		if _, exists := seen[value]; !exists {
			seen[value] = struct{}{}
			result = append(result, value)
		}
	}
	return result, nil
}

func ensureIDsExist(tx *sql.Tx, table string, ids []int64) error {
	query, arguments := countIDsQuery(table, ids)
	var count int
	if err := tx.QueryRow(query, arguments...).Scan(&count); err != nil {
		return err
	}
	if count != len(ids) {
		return fmt.Errorf("one or more %s records do not exist", table)
	}
	return nil
}

func ensureIDExists(tx *sql.Tx, table string, id int64) error {
	return ensureIDsExist(tx, table, []int64{id})
}

func applyTagOperation(tx *sql.Tx, operation string, sessions, tags []int64) error {
	if operation == "replace" {
		query, arguments := inQuery("DELETE FROM session_tags WHERE session_id IN (", sessions)
		if _, err := tx.Exec(query, arguments...); err != nil {
			return err
		}
	}
	if len(tags) == 0 {
		return nil
	}
	if operation == "remove" {
		return removeSessionTags(tx, sessions, tags)
	}
	return insertSessionTags(tx, sessions, tags)
}
