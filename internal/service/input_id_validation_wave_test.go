package service

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestOpenSerialAndSignalsRejectInvalidIDs(t *testing.T) {
	term := NewTerminalService(nil, discardEventBus{}, 8, slog.Default())
	_, err := term.OpenSerial(context.Background(), 0, 80, 24)
	require.Error(t, err)
	_, err = term.OpenSerial(context.Background(), -1, 80, 24)
	require.Error(t, err)

	require.Error(t, term.SerialSetSignals("", true, false))
	_, err = term.SerialSignals(" ")
	require.Error(t, err)
	require.Error(t, term.SerialBreak("", 100))
}

func TestDeleteImpactRejectInvalidIDs(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	logger := testutil.NewTestLogger()

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, logger)
	_, err = sessionSvc.SessionDeleteImpact(0)
	require.Error(t, err)
	_, err = sessionSvc.SessionDeleteImpact(-2)
	require.Error(t, err)

	catalog := NewAssetCatalogService(db, logger)
	_, err = catalog.EnvironmentDeleteImpact(0)
	require.Error(t, err)
	_, err = catalog.ProjectDeleteImpact(0)
	require.Error(t, err)
	_, err = catalog.TagDeleteImpact(0)
	require.Error(t, err)
}

func TestSettingServiceRejectEmptyKey(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })

	svc := NewSettingService(db, testutil.NewTestLogger())
	_, err = svc.Get("")
	require.Error(t, err)
	_, err = svc.Get("   ")
	require.Error(t, err)
	require.Error(t, svc.Delete(""))
}
