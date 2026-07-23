package service

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"

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

func TestSerialBreakRejectsNegativeDuration(t *testing.T) {
	term := NewTerminalService(nil, discardEventBus{}, 8, slog.Default())
	require.Error(t, term.SerialBreak("term-1", -1))
}

func TestLogServiceRejectsInvalidRecordingInputs(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	logSvc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())
	_, err = logSvc.StartTerminalRecording("", 1, 80, 24, "xterm")
	require.Error(t, err)
	_, err = logSvc.StartTerminalRecording("term-1", -1, 80, 24, "xterm")
	require.Error(t, err)
	require.Error(t, logSvc.StopTerminalRecordingIfActive(""))
}

func TestAISettingsRejectInvalidProviderIDs(t *testing.T) {
	zero := int64(0)
	neg := int64(-1)
	settings := defaultAISettings()
	settings.DefaultProviderID = &zero
	require.Error(t, validateAISettings(settings))
	settings = defaultAISettings()
	settings.FallbackProviderID = &neg
	require.Error(t, validateAISettings(settings))
}

func TestAuditListRejectsInvalidSessionID(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	svc := NewAuditService(db, testutil.NewTestLogger())
	sessionID := int64(0)
	_, err = svc.List(model.AuditFilter{SessionID: &sessionID, Limit: 10})
	require.Error(t, err)
}

func TestMacroExecuteRejectsEmptyCommand(t *testing.T) {
	svc := NewMacroService(nil, nil, testutil.NewTestLogger())
	require.Error(t, svc.Execute("term-1", "   "))
}

func TestKeyImportRejectsEmptyPrivateKey(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	svc := NewKeyService(db, nil, testutil.NewTestLogger())
	_, err = svc.Import("k", "  ")
	require.Error(t, err)
}

func TestKeyUpdateRejectsEmptyPrivateKey(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	svc := NewKeyService(db, nil, testutil.NewTestLogger())
	_, err = svc.Update(model.SSHKeyUpdateInput{ID: 1, Name: "k", PrivateKey: "  ", PublicKey: "y"})
	require.Error(t, err)
}

func TestThemeAssignmentsRejectInvalidProfileIDs(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	svc := NewThemeService(db, testutil.NewTestLogger())
	require.Error(t, svc.SaveAssignments(model.ThemeAssignmentsInput{
		FollowInterfaceMode: true,
		DarkProfileID:       0,
		LightProfileID:      0,
		FixedProfileID:      0,
	}))
}
