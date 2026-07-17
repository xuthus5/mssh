package store

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestAuditEventsRespectEnablementAndFilters(t *testing.T) {
	db := setupTestDB(t)
	sessionID := int64(7)
	event := model.AuditEvent{Action: "connect", TargetType: "session", TargetID: "7", SessionID: &sessionID, Summary: "SSH 连接", Outcome: "success", CreatedAt: time.Date(2026, 7, 17, 1, 2, 3, 0, time.UTC)}

	require.NoError(t, AppendAuditEvent(db, event))
	events, err := ListAuditEvents(db, model.AuditFilter{Limit: 100})
	require.NoError(t, err)
	assert.Empty(t, events)
	require.NoError(t, SetAuditEnabled(db, true))
	require.NoError(t, AppendAuditEvent(db, event))
	require.NoError(t, AppendAuditEvent(db, model.AuditEvent{Action: "delete", TargetType: "key", TargetID: "2", Summary: "删除密钥", Outcome: "failed"}))

	events, err = ListAuditEvents(db, model.AuditFilter{Action: "connect", SessionID: &sessionID, From: "2026-07-17T00:00:00Z", To: "2026-07-18T00:00:00Z", Limit: 100})
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, "SSH 连接", events[0].Summary)
	assert.Equal(t, time.UTC, events[0].CreatedAt.Location())
}
