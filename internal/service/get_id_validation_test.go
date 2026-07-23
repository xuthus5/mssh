package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestGetUpdateRestoreRejectInvalidIDs(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	logger := testutil.NewTestLogger()

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, logger)
	_, err = sessionSvc.GetSession(0)
	require.Error(t, err)
	_, err = sessionSvc.GetSession(-1)
	require.Error(t, err)

	serialSvc := NewSerialService(db, logger)
	_, err = serialSvc.Get(0)
	require.Error(t, err)

	themeSvc := NewThemeService(db, logger)
	_, err = themeSvc.GetProfile(0)
	require.Error(t, err)
	require.Error(t, themeSvc.UpdateProfile(model.ThemeProfileInput{ID: 0, Name: "x", ThemeID: 1, FontFamily: "Mono", FontSize: 14, CursorStyle: model.CursorStyleBlock, ColorOverrides: "{}"}))

	syncSvc := NewSyncService(db, logger)
	require.Error(t, syncSvc.RestoreVersion(0))
	require.Error(t, syncSvc.RestoreVersion(-3))

	keySvc := NewKeyService(db, nil, logger)
	_, err = keySvc.GetMaterial(0)
	require.Error(t, err)
	_, err = keySvc.Update(model.SSHKeyUpdateInput{ID: 0, Name: "k", PrivateKey: "x", PublicKey: "y"})
	require.Error(t, err)

	aiSvc := NewAIService(db, nil, nil, logger)
	_, err = aiSvc.ListConversations(0, 10)
	require.Error(t, err)
	_, err = aiSvc.ListMessages(0)
	require.Error(t, err)
	require.Error(t, aiSvc.TestProvider(0))

	catalog := NewAssetCatalogService(db, logger)
	_, err = catalog.GetSessionAssetDetail(0)
	require.Error(t, err)

	macroSvc := NewMacroService(db, nil, logger)
	require.Error(t, macroSvc.Update(model.MacroInput{ID: 0, Name: "m", Command: "echo"}))

	tunnelSvc := NewTunnelService(db, sessionSvc, newMockEventBus(), logger)
	require.Error(t, tunnelSvc.Update(model.TunnelInput{
		ID:         0,
		SessionID:  1,
		Name:       "t",
		Type:       model.TunnelLocal,
		LocalHost:  "127.0.0.1",
		LocalPort:  18080,
		RemoteHost: "127.0.0.1",
		RemotePort: 22,
	}))
}

func TestConnectLogListRejectInvalidSessionIDs(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	logger := testutil.NewTestLogger()

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, logger)
	_, err = sessionSvc.sessionForConnect(0)
	require.Error(t, err)

	logSvc := NewLogService(db, t.TempDir(), logger)
	neg := int64(-1)
	_, err = logSvc.List(&neg)
	require.Error(t, err)
	zero := int64(0)
	_, err = logSvc.List(&zero)
	require.NoError(t, err)
}
