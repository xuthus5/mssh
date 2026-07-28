package service

import (
	"database/sql"
	"fmt"
	"log/slog"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type AssetCatalogService struct {
	db        *sql.DB
	logger    *slog.Logger
	lifecycle serviceOperationGate
}

func NewAssetCatalogService(db *sql.DB, logger *slog.Logger) *AssetCatalogService {
	return &AssetCatalogService{db: db, logger: logger}
}

func (s *AssetCatalogService) ListEnvironments() ([]model.AssetEnvironment, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	rows, err := s.db.Query(`SELECT e.id, e.name, e.color_token, e.sort_order, COUNT(se.id), e.created_at, e.updated_at FROM asset_environments e LEFT JOIN sessions se ON se.environment_id = e.id GROUP BY e.id ORDER BY e.sort_order, e.name_key`)
	if err != nil {
		return nil, fmt.Errorf("list environments: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]model.AssetEnvironment, 0)
	for rows.Next() {
		item, scanErr := scanEnvironment(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *AssetCatalogService) ListProjects() ([]model.AssetProject, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	rows, err := s.db.Query(`SELECT p.id, p.name, p.code, p.description, p.sort_order, COUNT(se.id), p.created_at, p.updated_at FROM asset_projects p LEFT JOIN sessions se ON se.project_id = p.id GROUP BY p.id ORDER BY p.sort_order, p.name_key`)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]model.AssetProject, 0)
	for rows.Next() {
		item, scanErr := scanProject(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *AssetCatalogService) ListTags() ([]model.AssetTag, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	rows, err := s.db.Query(`SELECT t.id, t.name, t.color_token, COUNT(st.session_id), t.created_at, t.updated_at FROM asset_tags t LEFT JOIN session_tags st ON st.tag_id = t.id GROUP BY t.id ORDER BY t.name_key`)
	if err != nil {
		return nil, fmt.Errorf("list tags: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]model.AssetTag, 0)
	for rows.Next() {
		item, scanErr := scanTag(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *AssetCatalogService) CreateEnvironment(input model.AssetEnvironmentInput) (*model.AssetEnvironment, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	name, key, err := normalizeAssetName(input.Name, 64)
	if err != nil {
		return nil, err
	}
	if err := validateAssetColor(input.ColorToken); err != nil {
		return nil, err
	}
	sortOrder, err := normalizeAssetSortOrder(input.SortOrder)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("create environment: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`INSERT INTO asset_environments (name, name_key, color_token, sort_order) VALUES (?, ?, ?, ?)`, name, key, input.ColorToken, sortOrder)
	if err != nil {
		return nil, fmt.Errorf("create environment: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create environment: %w", err)
	}
	if err := appendCatalogAudit(tx, "create", "environment", id, "创建环境 "+name); err != nil {
		return nil, fmt.Errorf("create environment audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("create environment: %w", err)
	}
	return s.environment(id)
}

func (s *AssetCatalogService) UpdateEnvironment(input model.AssetEnvironmentInput) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	name, key, err := normalizeAssetName(input.Name, 64)
	if err != nil {
		return err
	}
	if err := validateAssetColor(input.ColorToken); err != nil {
		return err
	}
	sortOrder, err := normalizeAssetSortOrder(input.SortOrder)
	if err != nil {
		return err
	}
	return s.updateCatalogItem("environment", input.ID, "更新环境 "+name, func(tx *sql.Tx) (sql.Result, error) {
		return tx.Exec(`UPDATE asset_environments SET name=?, name_key=?, color_token=?, sort_order=?, updated_at=datetime('now') WHERE id=?`, name, key, input.ColorToken, sortOrder, input.ID)
	})
}

func (s *AssetCatalogService) CreateProject(input model.AssetProjectInput) (*model.AssetProject, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	name, key, code, codeKey, description, err := normalizeProject(input)
	if err != nil {
		return nil, err
	}
	sortOrder, err := normalizeAssetSortOrder(input.SortOrder)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`INSERT INTO asset_projects (name, name_key, code, code_key, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)`, name, key, code, codeKey, description, sortOrder)
	if err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}
	if err := appendCatalogAudit(tx, "create", "project", id, "创建项目 "+name); err != nil {
		return nil, fmt.Errorf("create project audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}
	return s.project(id)
}

func (s *AssetCatalogService) UpdateProject(input model.AssetProjectInput) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	name, key, code, codeKey, description, err := normalizeProject(input)
	if err != nil {
		return err
	}
	sortOrder, err := normalizeAssetSortOrder(input.SortOrder)
	if err != nil {
		return err
	}
	return s.updateCatalogItem("project", input.ID, "更新项目 "+name, func(tx *sql.Tx) (sql.Result, error) {
		return tx.Exec(`UPDATE asset_projects SET name=?, name_key=?, code=?, code_key=?, description=?, sort_order=?, updated_at=datetime('now') WHERE id=?`, name, key, code, codeKey, description, sortOrder, input.ID)
	})
}

func (s *AssetCatalogService) CreateTag(input model.AssetTagInput) (*model.AssetTag, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	name, key, err := normalizeAssetName(input.Name, 32)
	if err != nil {
		return nil, err
	}
	if err := validateAssetColor(input.ColorToken); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("create tag: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`INSERT INTO asset_tags (name, name_key, color_token) VALUES (?, ?, ?)`, name, key, input.ColorToken)
	if err != nil {
		return nil, fmt.Errorf("create tag: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create tag: %w", err)
	}
	if err := appendCatalogAudit(tx, "create", "tag", id, "创建标签 "+name); err != nil {
		return nil, fmt.Errorf("create tag audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("create tag: %w", err)
	}
	return s.tag(id)
}

func (s *AssetCatalogService) UpdateTag(input model.AssetTagInput) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	name, key, err := normalizeAssetName(input.Name, 32)
	if err != nil {
		return err
	}
	if err := validateAssetColor(input.ColorToken); err != nil {
		return err
	}
	return s.updateCatalogItem("tag", input.ID, "更新标签 "+name, func(tx *sql.Tx) (sql.Result, error) {
		return tx.Exec(`UPDATE asset_tags SET name=?, name_key=?, color_token=?, updated_at=datetime('now') WHERE id=?`, name, key, input.ColorToken, input.ID)
	})
}

func (s *AssetCatalogService) GetSessionAssetDetail(sessionID int64) (*model.Session, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if sessionID <= 0 {
		return nil, fmt.Errorf("invalid session id")
	}
	return store.GetSession(s.db, sessionID)
}
