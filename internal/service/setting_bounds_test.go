package service

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

const (
	testSettingBatchLimit     = 256
	testSettingKeyLimit       = 256
	testSettingNamespaceLimit = 64
	testSettingValueLimit     = 64 * 1024
)

func TestSettingServiceRejectsOversizedReadInputs(t *testing.T) {
	service := NewSettingService(testutil.NewTestDB(t), testutil.NewTestLogger())
	oversizedKey := "a." + strings.Repeat("k", testSettingKeyLimit-1)
	oversizedNamespace := strings.Repeat("n", testSettingNamespaceLimit+1)

	_, err := service.Get(oversizedKey)
	require.Error(t, err)
	_, err = service.GetMany([]string{oversizedKey})
	require.Error(t, err)
	_, err = service.List(oversizedNamespace)
	require.Error(t, err)
	require.Error(t, service.Delete(oversizedKey))
}

func TestSettingServiceRejectsOversizedAndDuplicateBatches(t *testing.T) {
	service := NewSettingService(testutil.NewTestDB(t), testutil.NewTestLogger())
	keys := make([]string, testSettingBatchLimit+1)
	inputs := make([]model.SettingInput, testSettingBatchLimit+1)
	for index := range keys {
		key := fmt.Sprintf("test.key_%03d", index)
		keys[index] = key
		inputs[index] = model.SettingInput{Key: key, Namespace: "test", Value: `null`, ValueType: "null", Version: 1}
	}

	_, err := service.GetMany(keys)
	require.Error(t, err)
	require.Error(t, service.SetMany(inputs))

	duplicateKey := "test.duplicate"
	_, err = service.GetMany([]string{duplicateKey, duplicateKey})
	require.Error(t, err)
	require.Error(t, service.SetMany([]model.SettingInput{
		{Key: duplicateKey, Namespace: "test", Value: `1`, ValueType: "number", Version: 1},
		{Key: duplicateKey, Namespace: "test", Value: `2`, ValueType: "number", Version: 1},
	}))

	stored, err := service.Get(duplicateKey)
	require.NoError(t, err)
	assert.Nil(t, stored)
}

func TestSettingServiceRejectsOversizedValueBeforePersistence(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSettingService(db, testutil.NewTestLogger())
	input := model.SettingInput{
		Key:       "test.large_value",
		Namespace: "test",
		Value:     `"` + strings.Repeat("v", testSettingValueLimit-1) + `"`,
		ValueType: "string",
		Version:   1,
	}

	require.Error(t, service.Set(input))
	stored, err := service.Get(input.Key)
	require.NoError(t, err)
	assert.Nil(t, stored)
}
