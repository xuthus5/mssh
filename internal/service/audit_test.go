package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestAuditServiceRecordsValidatedBatchEvents(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAuditService(db, testutil.NewTestLogger())
	require.NoError(t, service.SetEnabled(true))

	require.NoError(t, service.RecordBatch("batch_macro", []int64{1, 2}, []string{"success", "failed"}))
	events, err := service.List(model.AuditFilter{Action: "batch_macro", Limit: 10})
	require.NoError(t, err)
	require.Len(t, events, 2)
	assert.Equal(t, "failed", events[0].Outcome)
	assert.NotContains(t, events[0].Summary, "command")

	require.NoError(t, service.RecordBatch("batch_delete", []int64{3}, []string{"success"}))
	events, err = service.List(model.AuditFilter{Action: "batch_delete", Limit: 10})
	require.NoError(t, err)
	require.Len(t, events, 1)

	require.Error(t, service.RecordBatch("unknown", []int64{1}, []string{"success"}))
	require.Error(t, service.RecordBatch("batch_macro", []int64{1}, nil))
	require.Error(t, service.RecordBatch("batch_macro", []int64{1}, []string{"secret"}))
}
