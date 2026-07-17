package service

import (
	"fmt"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/model"
)

const sessionNotesLimit = 2000

func validateSessionAssetInput(input model.SessionInput, updating bool) error {
	if updating && input.ID <= 0 {
		return fmt.Errorf("invalid session id")
	}
	if utf8.RuneCountInString(input.Notes) > sessionNotesLimit {
		return fmt.Errorf("session notes must not exceed %d characters", sessionNotesLimit)
	}
	if err := validateOptionalAssetID("environment", input.EnvironmentID); err != nil {
		return err
	}
	if err := validateOptionalAssetID("project", input.ProjectID); err != nil {
		return err
	}
	seen := make(map[int64]struct{}, len(input.TagIDs))
	for _, id := range input.TagIDs {
		if id <= 0 {
			return fmt.Errorf("invalid tag id %d", id)
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("duplicate tag id %d", id)
		}
		seen[id] = struct{}{}
	}
	return nil
}

func validateOptionalAssetID(kind string, id *int64) error {
	if id != nil && *id <= 0 {
		return fmt.Errorf("invalid %s id", kind)
	}
	return nil
}
