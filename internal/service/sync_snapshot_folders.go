package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

func validateSnapshotFolders(rows []map[string]any) error {
	if len(rows) == 0 {
		return fmt.Errorf("table session_folders must contain a default folder")
	}
	folders := make(map[int64]model.SessionFolder, len(rows))
	for index, row := range rows {
		folder, err := snapshotFolderFromRow(row)
		if err != nil {
			return fmt.Errorf("table session_folders row %d: %w", index, err)
		}
		if _, duplicate := folders[folder.ID]; duplicate {
			return fmt.Errorf("table session_folders row %d: duplicate folder id %d", index, folder.ID)
		}
		if err := validateSnapshotFolder(folder); err != nil {
			return fmt.Errorf("table session_folders row %d: %w", index, err)
		}
		folders[folder.ID] = folder
	}
	return validateSnapshotFolderGraph(folders)
}

func snapshotFolderFromRow(row map[string]any) (model.SessionFolder, error) {
	var folder model.SessionFolder
	var err error
	if folder.ID, err = snapshotInt64Field(row, "id"); err != nil {
		return model.SessionFolder{}, err
	}
	if folder.Name, err = snapshotStringField(row, "name"); err != nil {
		return model.SessionFolder{}, err
	}
	if folder.ParentID, err = snapshotNullableInt64Field(row, "parent_id"); err != nil {
		return model.SessionFolder{}, err
	}
	if folder.IsDefault, err = snapshotBoolIntegerField(row, "is_default"); err != nil {
		return model.SessionFolder{}, err
	}
	if folder.SortOrder, err = snapshotIntField(row, "sort_order"); err != nil {
		return model.SessionFolder{}, err
	}
	if folder.CreatedAt, err = snapshotTimeField(row, "created_at"); err != nil {
		return model.SessionFolder{}, err
	}
	folder.UpdatedAt, err = snapshotTimeField(row, "updated_at")
	return folder, err
}

func validateSnapshotFolder(folder model.SessionFolder) error {
	if folder.ID <= 0 {
		return fmt.Errorf("invalid folder id")
	}
	normalizedName, err := validateFolderName(folder.Name)
	if err != nil {
		return err
	}
	if normalizedName != folder.Name {
		return fmt.Errorf("folder name must not contain surrounding whitespace")
	}
	if err := validateOptionalParentFolderID(folder.ParentID); err != nil {
		return err
	}
	if _, err := normalizeAssetSortOrder(folder.SortOrder); err != nil {
		return fmt.Errorf("folder %w", err)
	}
	if folder.IsDefault && folder.ParentID != nil {
		return fmt.Errorf("default folder must not have a parent")
	}
	return nil
}

func validateSnapshotFolderGraph(folders map[int64]model.SessionFolder) error {
	defaultCount := 0
	for id, folder := range folders {
		if folder.IsDefault {
			defaultCount++
		}
		if folder.ParentID == nil {
			continue
		}
		if *folder.ParentID == id {
			return fmt.Errorf("folder %d must not be its own parent", id)
		}
		if _, exists := folders[*folder.ParentID]; !exists {
			return fmt.Errorf("folder %d references missing parent %d", id, *folder.ParentID)
		}
	}
	if defaultCount != 1 {
		return fmt.Errorf("table session_folders must contain exactly one default folder")
	}
	settled := make(map[int64]struct{}, len(folders))
	for id := range folders {
		if err := validateSnapshotFolderPath(id, folders, settled); err != nil {
			return err
		}
	}
	return nil
}

func validateSnapshotFolderPath(
	start int64,
	folders map[int64]model.SessionFolder,
	settled map[int64]struct{},
) error {
	path := make(map[int64]struct{})
	current := start
	for {
		if _, complete := settled[current]; complete {
			break
		}
		if _, repeated := path[current]; repeated {
			return fmt.Errorf("session folder hierarchy contains a cycle at folder %d", current)
		}
		path[current] = struct{}{}
		parentID := folders[current].ParentID
		if parentID == nil {
			break
		}
		current = *parentID
	}
	for id := range path {
		settled[id] = struct{}{}
	}
	return nil
}
