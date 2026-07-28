package service

import (
	"database/sql"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

func (s *AssetCatalogService) environment(id int64) (*model.AssetEnvironment, error) {
	item, err := scanEnvironment(s.db.QueryRow(`SELECT e.id, e.name, e.color_token, e.sort_order, COUNT(se.id), e.created_at, e.updated_at FROM asset_environments e LEFT JOIN sessions se ON se.environment_id=e.id WHERE e.id=? GROUP BY e.id`, id))
	if err != nil {
		return nil, fmt.Errorf("get environment: %w", err)
	}
	return &item, nil
}

func (s *AssetCatalogService) project(id int64) (*model.AssetProject, error) {
	item, err := scanProject(s.db.QueryRow(`SELECT p.id, p.name, p.code, p.description, p.sort_order, COUNT(se.id), p.created_at, p.updated_at FROM asset_projects p LEFT JOIN sessions se ON se.project_id=p.id WHERE p.id=? GROUP BY p.id`, id))
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	return &item, nil
}

func (s *AssetCatalogService) tag(id int64) (*model.AssetTag, error) {
	item, err := scanTag(s.db.QueryRow(`SELECT t.id, t.name, t.color_token, COUNT(st.session_id), t.created_at, t.updated_at FROM asset_tags t LEFT JOIN session_tags st ON st.tag_id=t.id WHERE t.id=? GROUP BY t.id`, id))
	if err != nil {
		return nil, fmt.Errorf("get tag: %w", err)
	}
	return &item, nil
}

func requireAssetAffected(result sql.Result, kind string) error {
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return fmt.Errorf("%s not found", kind)
	}
	return nil
}

func (s *AssetCatalogService) updateCatalogItem(kind string, id int64, summary string, update func(*sql.Tx) (sql.Result, error)) error {
	if id <= 0 {
		return fmt.Errorf("invalid %s id", kind)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("update %s: %w", kind, err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := update(tx)
	if err != nil {
		return fmt.Errorf("update %s: %w", kind, err)
	}
	if err := requireAssetAffected(result, kind); err != nil {
		return err
	}
	if err := appendCatalogAudit(tx, "update", kind, id, summary); err != nil {
		return fmt.Errorf("update %s audit: %w", kind, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("update %s: %w", kind, err)
	}
	return nil
}
