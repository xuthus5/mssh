package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

func (s *AssetCatalogService) EnvironmentDeleteImpact(id int64) (*model.AssetDeleteImpact, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if id <= 0 {
		return nil, fmt.Errorf("invalid environment id")
	}
	return assetDeleteImpact(s.db, "asset_environments", "environment_id", id)
}

func (s *AssetCatalogService) ProjectDeleteImpact(id int64) (*model.AssetDeleteImpact, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if id <= 0 {
		return nil, fmt.Errorf("invalid project id")
	}
	return assetDeleteImpact(s.db, "asset_projects", "project_id", id)
}

func (s *AssetCatalogService) TagDeleteImpact(id int64) (*model.AssetDeleteImpact, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if id <= 0 {
		return nil, fmt.Errorf("invalid tag id")
	}
	var impact model.AssetDeleteImpact
	err = s.db.QueryRow(`SELECT t.id, t.name, COUNT(st.session_id) FROM asset_tags t LEFT JOIN session_tags st ON st.tag_id=t.id WHERE t.id=? GROUP BY t.id`, id).Scan(&impact.ID, &impact.Name, &impact.SessionCount)
	if err != nil {
		return nil, fmt.Errorf("tag delete impact: %w", err)
	}
	return &impact, nil
}

func (s *AssetCatalogService) DeleteEnvironment(input model.AssetDeleteInput) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	return s.deleteAssignableAsset("asset_environments", "environment_id", "environment", input)
}

func (s *AssetCatalogService) DeleteProject(input model.AssetDeleteInput) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	return s.deleteAssignableAsset("asset_projects", "project_id", "project", input)
}

func (s *AssetCatalogService) DeleteTag(id int64) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if id <= 0 {
		return fmt.Errorf("invalid tag id")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("delete tag: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	impact, err := tagDeleteImpactTx(tx, id)
	if err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM session_tags WHERE tag_id=?", id); err != nil {
		return fmt.Errorf("delete tag associations: %w", err)
	}
	if _, err := tx.Exec("DELETE FROM asset_tags WHERE id=?", id); err != nil {
		return fmt.Errorf("delete tag: %w", err)
	}
	if err := appendAssetAudit(tx, model.AuditEvent{Action: "delete", TargetType: "asset_tag", TargetID: fmt.Sprint(id), Summary: fmt.Sprintf("删除标签 %s，移除 %d 条会话关联", impact.Name, impact.SessionCount), Outcome: "success"}); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *AssetCatalogService) BulkSetEnvironment(input model.BulkAssetAssignmentInput) (int, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return 0, err
	}
	defer finish()
	return s.bulkSetAsset("environment_id", "asset_environments", "bulk_set_environment", input)
}

func (s *AssetCatalogService) BulkSetProject(input model.BulkAssetAssignmentInput) (int, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return 0, err
	}
	defer finish()
	return s.bulkSetAsset("project_id", "asset_projects", "bulk_set_project", input)
}

func (s *AssetCatalogService) BulkUpdateTags(input model.BulkTagUpdateInput) (int, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return 0, err
	}
	defer finish()
	sessionIDs, err := normalizedIDs(input.SessionIDs)
	if err != nil {
		return 0, err
	}
	tagIDs, err := normalizedIDsAllowEmpty(input.TagIDs)
	if err != nil {
		return 0, err
	}
	if input.Operation != "add" && input.Operation != "remove" && input.Operation != "replace" {
		return 0, fmt.Errorf("invalid tag operation %q", input.Operation)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("bulk update tags: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := ensureIDsExist(tx, "sessions", sessionIDs); err != nil {
		return 0, err
	}
	if len(tagIDs) > 0 {
		if err := ensureIDsExist(tx, "asset_tags", tagIDs); err != nil {
			return 0, err
		}
	}
	if err := applyTagOperation(tx, input.Operation, sessionIDs, tagIDs); err != nil {
		return 0, err
	}
	if err := appendAssetAudit(tx, model.AuditEvent{Action: "bulk_tags_" + input.Operation, TargetType: "session", Summary: fmt.Sprintf("批量%s标签，影响 %d 个会话", input.Operation, len(sessionIDs)), Outcome: "success"}); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(sessionIDs), nil
}

func (s *AssetCatalogService) ReorderEnvironments(ids []int64) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	return s.reorderAssets("asset_environments", "environment", ids)
}

func (s *AssetCatalogService) ReorderProjects(ids []int64) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	return s.reorderAssets("asset_projects", "project", ids)
}
