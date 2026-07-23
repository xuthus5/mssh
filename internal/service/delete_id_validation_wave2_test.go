package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestDeleteIDValidationWave2(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	logger := testutil.NewTestLogger()

	catalog := NewAssetCatalogService(db, logger)
	require.Error(t, catalog.DeleteTag(0))
	require.Error(t, catalog.DeleteEnvironment(model.AssetDeleteInput{ID: 0, Mode: "clear"}))
	require.Error(t, catalog.DeleteProject(model.AssetDeleteInput{ID: 0, Mode: "clear"}))

	ai := NewAIService(db, nil, nil, logger)
	require.Error(t, ai.DeleteProvider(0))
	require.Error(t, ai.DeleteConversation(0))

	theme := NewThemeService(db, logger)
	require.Error(t, theme.DeleteProfile(0))
	require.Error(t, theme.DeleteDefinition(0))

	logSvc := NewLogService(db, t.TempDir(), logger)
	require.Error(t, logSvc.Delete(0))

	syncSvc := NewSyncService(db, logger)
	require.Error(t, syncSvc.DeleteVersion(0))
}
