package service

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	sessionNotesLimit    = 2000
	sessionNameLimit     = 128
	sessionHostLimit     = 255
	sessionUsernameLimit = 128
	sessionTermTypeLimit = 64
	sessionKeepAliveMax  = 86400
)

func validateSessionAssetInput(input model.SessionInput, updating bool) error {
	if updating && input.ID <= 0 {
		return fmt.Errorf("invalid session id")
	}
	if err := validateSessionCoreFields(input); err != nil {
		return err
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
	if err := validateOptionalAssetID("folder", input.FolderID); err != nil {
		return err
	}
	if err := validateOptionalAssetID("key", input.KeyID); err != nil {
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

func validateSessionCoreFields(input model.SessionInput) error {
	if err := validateSessionText("name", strings.TrimSpace(input.Name), 1, sessionNameLimit); err != nil {
		return err
	}
	if err := validateSessionText("host", strings.TrimSpace(input.Host), 1, sessionHostLimit); err != nil {
		return err
	}
	if strings.ContainsRune(input.Host, 0) {
		return fmt.Errorf("host contains NUL")
	}
	if input.Port < 1 || input.Port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	if err := validateSessionText("username", strings.TrimSpace(input.Username), 1, sessionUsernameLimit); err != nil {
		return err
	}
	if strings.ContainsRune(input.Username, 0) {
		return fmt.Errorf("username contains NUL")
	}
	if err := validateSessionAuthMethod(input.AuthMethod); err != nil {
		return err
	}
	if input.AuthMethod == model.AuthKey && (input.KeyID == nil || *input.KeyID <= 0) {
		return fmt.Errorf("key auth requires a valid key id")
	}
	if input.KeepAlive < 0 || input.KeepAlive > sessionKeepAliveMax {
		return fmt.Errorf("keep_alive must be between 0 and %d", sessionKeepAliveMax)
	}
	termType := strings.TrimSpace(input.TermType)
	if termType == "" {
		return nil
	}
	return validateSessionText("term_type", termType, 1, sessionTermTypeLimit)
}

func validateSessionAuthMethod(method model.AuthMethod) error {
	switch method {
	case model.AuthPassword, model.AuthKey, model.AuthAgent, model.AuthKeyboardInteractive:
		return nil
	default:
		return fmt.Errorf("unsupported auth_method %q", method)
	}
}

func validateSessionText(name, value string, minimum, maximum int) error {
	length := utf8.RuneCountInString(value)
	if length < minimum || length > maximum {
		return fmt.Errorf("%s must contain between %d and %d characters", name, minimum, maximum)
	}
	return nil
}

func validateOptionalAssetID(kind string, id *int64) error {
	if id != nil && *id <= 0 {
		return fmt.Errorf("invalid %s id", kind)
	}
	return nil
}

const sessionFolderNameLimit = 128

func validateFolderName(name string) (string, error) {
	normalized := strings.TrimSpace(name)
	if normalized == "" || utf8.RuneCountInString(normalized) > sessionFolderNameLimit {
		return "", fmt.Errorf("folder name must contain between 1 and %d characters", sessionFolderNameLimit)
	}
	if strings.ContainsRune(normalized, 0) {
		return "", fmt.Errorf("folder name contains NUL")
	}
	return normalized, nil
}

func validateOptionalParentFolderID(parentID *int64) error {
	if parentID != nil && *parentID <= 0 {
		return fmt.Errorf("invalid parent folder id")
	}
	return nil
}
