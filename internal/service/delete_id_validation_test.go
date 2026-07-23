package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestMacroCommandHistoryTunnelRejectInvalidIDs(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })

	macroSvc := NewMacroService(db, nil, testutil.NewTestLogger())
	require.Error(t, macroSvc.Delete(0))

	hist := NewCommandHistoryService(db, testutil.NewTestLogger())
	_, err = hist.Add(0, "ls")
	require.Error(t, err)
	_, err = hist.List(0, "")
	require.Error(t, err)
	require.Error(t, hist.Delete(0))
	require.Error(t, hist.Clear(0))

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	tunnelSvc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())
	require.Error(t, tunnelSvc.Delete(0))
	require.Error(t, tunnelSvc.Stop(0))
	require.Error(t, tunnelSvc.Start(0))
}
