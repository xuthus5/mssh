package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSnapshotIntegerFieldReaders(t *testing.T) {
	value, err := snapshotInt64Field(map[string]any{"id": int64(7)}, "id")
	require.NoError(t, err)
	assert.Equal(t, int64(7), value)
	_, err = snapshotInt64Field(map[string]any{}, "id")
	require.ErrorContains(t, err, "missing id")
	_, err = snapshotInt64Field(map[string]any{"id": "7"}, "id")
	require.ErrorContains(t, err, "must be an integer")

	converted, err := snapshotIntField(map[string]any{"port": int64(22)}, "port")
	require.NoError(t, err)
	assert.Equal(t, 22, converted)
	_, err = snapshotIntField(map[string]any{"port": "22"}, "port")
	require.Error(t, err)

	flag, err := snapshotBoolIntegerField(map[string]any{"enabled": int64(0)}, "enabled")
	require.NoError(t, err)
	assert.False(t, flag)
	flag, err = snapshotBoolIntegerField(map[string]any{"enabled": int64(1)}, "enabled")
	require.NoError(t, err)
	assert.True(t, flag)
	_, err = snapshotBoolIntegerField(map[string]any{"enabled": int64(2)}, "enabled")
	require.Error(t, err)
	_, err = snapshotBoolIntegerField(map[string]any{}, "enabled")
	require.Error(t, err)
}

func TestSnapshotNullableFieldReaders(t *testing.T) {
	value, err := snapshotNullableInt64Field(map[string]any{"id": int64(7)}, "id")
	require.NoError(t, err)
	require.NotNil(t, value)
	assert.Equal(t, int64(7), *value)
	value, err = snapshotNullableInt64Field(map[string]any{"id": nil}, "id")
	require.NoError(t, err)
	assert.Nil(t, value)
	_, err = snapshotNullableInt64Field(map[string]any{}, "id")
	require.ErrorContains(t, err, "missing id")
	_, err = snapshotNullableInt64Field(map[string]any{"id": "7"}, "id")
	require.Error(t, err)

	text, err := snapshotNullableStringField(map[string]any{"password": "cipher"}, "password")
	require.NoError(t, err)
	assert.Equal(t, "cipher", text)
	text, err = snapshotNullableStringField(map[string]any{"password": nil}, "password")
	require.NoError(t, err)
	assert.Empty(t, text)
	_, err = snapshotNullableStringField(map[string]any{}, "password")
	require.ErrorContains(t, err, "missing password")
	_, err = snapshotNullableStringField(map[string]any{"password": int64(1)}, "password")
	require.Error(t, err)
}

func TestSnapshotTimeFieldReaders(t *testing.T) {
	const timestamp = "2026-07-28 12:01:02"
	value, err := snapshotTimeField(map[string]any{"created_at": timestamp}, "created_at")
	require.NoError(t, err)
	assert.Equal(t, 2026, value.Year())
	_, err = snapshotTimeField(map[string]any{}, "created_at")
	require.Error(t, err)

	nullable, err := snapshotNullableTimeField(map[string]any{"last_connected_at": timestamp}, "last_connected_at")
	require.NoError(t, err)
	require.NotNil(t, nullable)
	nullable, err = snapshotNullableTimeField(map[string]any{"last_connected_at": nil}, "last_connected_at")
	require.NoError(t, err)
	assert.Nil(t, nullable)
	_, err = snapshotNullableTimeField(map[string]any{}, "last_connected_at")
	require.Error(t, err)
	_, err = snapshotNullableTimeField(map[string]any{"last_connected_at": int64(1)}, "last_connected_at")
	require.Error(t, err)
	_, err = parseSnapshotTime("created_at", "2026-13-28 12:00:00")
	require.Error(t, err)
}
