package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSessionServiceMoveAndDefaultRejectInvalidIDs(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	require.Error(t, svc.SetDefaultFolder(0))
	require.Error(t, svc.MoveFolder(0, nil))
	zero := int64(0)
	require.Error(t, svc.MoveFolder(1, &zero))
	require.Error(t, svc.MoveSession(0, nil))
	require.Error(t, svc.MoveSession(1, &zero))
	require.Error(t, svc.DeleteFolder(0))
	require.Error(t, svc.DeleteSession(0))
	zeroFolder := int64(0)
	_, err = svc.ListSessions(&zeroFolder)
	require.Error(t, err)
}
