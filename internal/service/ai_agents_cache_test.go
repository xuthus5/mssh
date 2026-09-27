package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestGetAgentCLIStatusesReturnsEmptyWithoutCache(t *testing.T) {
	service := NewAIService(testutil.NewTestDB(t), nil, nil, testutil.NewTestLogger())
	assert.Empty(t, service.GetAgentCLIStatuses())
	assert.Empty(t, NewAIService(nil, nil, nil, testutil.NewTestLogger()).GetAgentCLIStatuses())
}

func TestDetectAgentCLIsCachesSnapshot(t *testing.T) {
	service := NewAIService(testutil.NewTestDB(t), nil, nil, testutil.NewTestLogger())
	t.Setenv("PATH", t.TempDir())

	detected := service.DetectAgentCLIs()
	require.Len(t, detected, 3)

	cached := service.GetAgentCLIStatuses()
	require.Len(t, cached, 3)
	assert.Equal(t, detected[0].Command, cached[0].Command)
	assert.Equal(t, detected[2].Name, cached[2].Name)
}

func TestGetAgentCLIStatusesIgnoresInvalidCache(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: "ai.agent_cli_status", Namespace: "ai", Value: "null", ValueType: "null", Version: 1,
	}}))
	assert.Empty(t, service.GetAgentCLIStatuses())

	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: "ai.agent_cli_status", Namespace: "ai", Value: "[]", ValueType: "array", Version: 1,
	}}))
	assert.Empty(t, service.GetAgentCLIStatuses())
}
