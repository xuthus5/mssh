package service

import (
	"fmt"
	"time"
)

func snapshotInt64Field(row map[string]any, field string) (int64, error) {
	raw, exists := row[field]
	if !exists {
		return 0, fmt.Errorf("missing %s", field)
	}
	value, ok := raw.(int64)
	if !ok {
		return 0, fmt.Errorf("%s must be an integer", field)
	}
	return value, nil
}

func snapshotIntField(row map[string]any, field string) (int, error) {
	value, err := snapshotInt64Field(row, field)
	if err != nil {
		return 0, err
	}
	converted := int(value)
	if int64(converted) != value {
		return 0, fmt.Errorf("%s exceeds platform integer range", field)
	}
	return converted, nil
}

func snapshotBoolIntegerField(row map[string]any, field string) (bool, error) {
	value, err := snapshotInt64Field(row, field)
	if err != nil {
		return false, err
	}
	switch value {
	case 0:
		return false, nil
	case 1:
		return true, nil
	default:
		return false, fmt.Errorf("%s must be integer 0 or 1", field)
	}
}

func snapshotNullableInt64Field(row map[string]any, field string) (*int64, error) {
	raw, exists := row[field]
	if !exists {
		return nil, fmt.Errorf("missing %s", field)
	}
	if raw == nil {
		return nil, nil
	}
	value, ok := raw.(int64)
	if !ok {
		return nil, fmt.Errorf("%s must be an integer or null", field)
	}
	return &value, nil
}

func snapshotNullableStringField(row map[string]any, field string) (string, error) {
	raw, exists := row[field]
	if !exists {
		return "", fmt.Errorf("missing %s", field)
	}
	if raw == nil {
		return "", nil
	}
	value, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("%s must be a string or null", field)
	}
	return value, nil
}

func snapshotTimeField(row map[string]any, field string) (time.Time, error) {
	raw, err := snapshotStringField(row, field)
	if err != nil {
		return time.Time{}, err
	}
	return parseSnapshotTime(field, raw)
}

func snapshotNullableTimeField(row map[string]any, field string) (*time.Time, error) {
	raw, exists := row[field]
	if !exists {
		return nil, fmt.Errorf("missing %s", field)
	}
	if raw == nil {
		return nil, nil
	}
	value, ok := raw.(string)
	if !ok {
		return nil, fmt.Errorf("%s must be a string or null", field)
	}
	parsed, err := parseSnapshotTime(field, value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func parseSnapshotTime(field, value string) (time.Time, error) {
	if len(value) != len(snapshotTimestampLayout) {
		return time.Time{}, fmt.Errorf("invalid %s length", field)
	}
	parsed, err := time.Parse(snapshotTimestampLayout, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid %s: %w", field, err)
	}
	return parsed, nil
}
