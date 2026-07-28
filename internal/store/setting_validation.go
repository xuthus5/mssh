package store

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	maxSettingBatchEntries   = 256
	maxSettingKeyBytes       = 256
	maxSettingNamespaceBytes = 64
	maxSettingValueBytes     = 64 * 1024
)

// ValidateSettingBatchSize rejects setting batches that could cause unbounded work.
func ValidateSettingBatchSize(count int) error {
	if count > maxSettingBatchEntries {
		return fmt.Errorf("setting batch exceeds %d entries", maxSettingBatchEntries)
	}
	return nil
}

// ValidateSettingKey validates a setting key at read and write boundaries.
func ValidateSettingKey(key string) error {
	return validateSettingIdentifier("key", key, maxSettingKeyBytes)
}

// ValidateSettingNamespace validates a setting namespace at read and write boundaries.
func ValidateSettingNamespace(namespace string) error {
	return validateSettingIdentifier("namespace", namespace, maxSettingNamespaceBytes)
}

// ValidateSettingKeys validates a bounded collection of unique setting keys.
func ValidateSettingKeys(keys []string) error {
	if err := ValidateSettingBatchSize(len(keys)); err != nil {
		return err
	}
	seen := make(map[string]struct{}, len(keys))
	for index, key := range keys {
		if err := ValidateSettingKey(key); err != nil {
			return fmt.Errorf("setting key %d: %w", index, err)
		}
		if _, exists := seen[key]; exists {
			return fmt.Errorf("duplicate setting key %q", key)
		}
		seen[key] = struct{}{}
	}
	return nil
}

// ValidateSettings validates a bounded collection of unique persisted settings.
func ValidateSettings(settings []model.Setting) error {
	return validateSettings(settings)
}

func validateSettings(settings []model.Setting) error {
	if err := ValidateSettingBatchSize(len(settings)); err != nil {
		return err
	}
	seen := make(map[string]struct{}, len(settings))
	for index, setting := range settings {
		if err := validateSetting(setting); err != nil {
			return fmt.Errorf("setting %d: %w", index, err)
		}
		if _, exists := seen[setting.Key]; exists {
			return fmt.Errorf("duplicate setting key %q", setting.Key)
		}
		seen[setting.Key] = struct{}{}
	}
	return nil
}

func validateSetting(setting model.Setting) error {
	if err := ValidateSettingKey(setting.Key); err != nil {
		return err
	}
	if err := ValidateSettingNamespace(setting.Namespace); err != nil {
		return err
	}
	if setting.Namespace == "legacy" || !strings.HasPrefix(setting.Key, setting.Namespace+".") {
		return fmt.Errorf("invalid setting key or namespace")
	}
	if setting.Version != 1 {
		return fmt.Errorf("invalid setting version")
	}
	if err := validateDeclaredSettingValueType(setting.ValueType); err != nil {
		return err
	}
	if !utf8.ValidString(setting.Value) {
		return fmt.Errorf("setting value must be valid UTF-8")
	}
	if len(setting.Value) > maxSettingValueBytes {
		return fmt.Errorf("setting value exceeds %d bytes", maxSettingValueBytes)
	}
	valueType, err := settingJSONType(setting.Value)
	if err != nil {
		return err
	}
	if setting.ValueType != valueType {
		return fmt.Errorf("invalid setting value type: got %s, want %s", setting.ValueType, valueType)
	}
	return nil
}

func validateDeclaredSettingValueType(valueType string) error {
	switch valueType {
	case "string", "number", "boolean", "array", "object", "null":
		return nil
	default:
		return fmt.Errorf("invalid setting value type")
	}
}

func validateSettingIdentifier(name, value string, maxBytes int) error {
	if !utf8.ValidString(value) {
		return fmt.Errorf("setting %s must be valid UTF-8", name)
	}
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("setting %s is required", name)
	}
	if len(value) > maxBytes {
		return fmt.Errorf("setting %s exceeds %d bytes", name, maxBytes)
	}
	if strings.ContainsRune(value, '\x00') {
		return fmt.Errorf("setting %s contains NUL", name)
	}
	return nil
}

func settingJSONType(raw string) (string, error) {
	if !json.Valid([]byte(raw)) {
		return "", fmt.Errorf("invalid setting JSON")
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return "", fmt.Errorf("decode setting JSON: %w", err)
	}
	return settingValueType(value)
}

func settingValueType(value any) (string, error) {
	switch value.(type) {
	case nil:
		return "null", nil
	case string:
		return "string", nil
	case json.Number:
		return "number", nil
	case bool:
		return "boolean", nil
	case []any:
		return "array", nil
	case map[string]any:
		return "object", nil
	default:
		return "", fmt.Errorf("invalid setting JSON type")
	}
}
