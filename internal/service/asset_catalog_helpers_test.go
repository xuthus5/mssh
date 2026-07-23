package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestNormalizeAssetSortOrder(t *testing.T) {
	_, err := normalizeAssetSortOrder(-1)
	require.Error(t, err)
	_, err = normalizeAssetSortOrder(maxAssetSortOrder + 1)
	require.Error(t, err)
	value, err := normalizeAssetSortOrder(12)
	require.NoError(t, err)
	require.Equal(t, 12, value)
}

func TestNormalizeAssetNameRejectsNUL(t *testing.T) {
	_, _, err := normalizeAssetName(string([]byte{'a', 0}), 64)
	require.Error(t, err)
}

func TestNormalizeProjectRejectsNUL(t *testing.T) {
	_, _, _, _, _, err := normalizeProject(model.AssetProjectInput{Name: "pay", Code: string([]byte{'a', 0}), Description: "ok"})
	require.Error(t, err)
	_, _, _, _, _, err = normalizeProject(model.AssetProjectInput{Name: "pay", Code: "ok", Description: string([]byte{'d', 0})})
	require.Error(t, err)
	_, _, _, _, _, err = normalizeProject(model.AssetProjectInput{Name: "pay", Code: strings.Repeat("c", 25)})
	require.Error(t, err)
}
