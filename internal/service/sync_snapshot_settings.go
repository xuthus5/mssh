package service

import (
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const snapshotTimestampLayout = "2006-01-02 15:04:05"

func validateSnapshotSettings(rows []map[string]any) error {
	if err := store.ValidateSettingBatchSize(len(rows)); err != nil {
		return fmt.Errorf("table settings: %w", err)
	}
	settings := make([]model.Setting, len(rows))
	for index, row := range rows {
		setting, err := snapshotSettingFromRow(row)
		if err != nil {
			return fmt.Errorf("table settings row %d: %w", index, err)
		}
		settings[index] = setting
	}
	if err := store.ValidateSettings(settings); err != nil {
		return fmt.Errorf("table settings: %w", err)
	}
	return nil
}

func snapshotSettingFromRow(row map[string]any) (model.Setting, error) {
	key, err := snapshotStringField(row, "key")
	if err != nil {
		return model.Setting{}, err
	}
	namespace, err := snapshotStringField(row, "namespace")
	if err != nil {
		return model.Setting{}, err
	}
	value, err := snapshotStringField(row, "value")
	if err != nil {
		return model.Setting{}, err
	}
	valueType, err := snapshotStringField(row, "value_type")
	if err != nil {
		return model.Setting{}, err
	}
	version, err := snapshotSettingVersion(row)
	if err != nil {
		return model.Setting{}, err
	}
	updatedAt, err := snapshotSettingUpdatedAt(row)
	if err != nil {
		return model.Setting{}, err
	}
	return model.Setting{
		Key: key, Namespace: namespace, Value: value, ValueType: valueType,
		Version: version, UpdatedAt: updatedAt,
	}, nil
}

func snapshotStringField(row map[string]any, field string) (string, error) {
	raw, exists := row[field]
	if !exists {
		return "", fmt.Errorf("missing %s", field)
	}
	value, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("%s must be a string", field)
	}
	return value, nil
}

func snapshotSettingVersion(row map[string]any) (int, error) {
	raw, exists := row["version"]
	if !exists {
		return 0, fmt.Errorf("missing version")
	}
	value, ok := raw.(int64)
	if !ok || int64(int(value)) != value {
		return 0, fmt.Errorf("version must be an integer")
	}
	return int(value), nil
}

func snapshotSettingUpdatedAt(row map[string]any) (time.Time, error) {
	raw, err := snapshotStringField(row, "updated_at")
	if err != nil {
		return time.Time{}, err
	}
	if len(raw) != len(snapshotTimestampLayout) {
		return time.Time{}, fmt.Errorf("invalid updated_at length")
	}
	value, err := time.Parse(snapshotTimestampLayout, raw)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid updated_at: %w", err)
	}
	return value, nil
}
