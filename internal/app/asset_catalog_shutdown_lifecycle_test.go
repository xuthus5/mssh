package app

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type appAssetTagCreateResult struct {
	tag *model.AssetTag
	err error
}

func TestAppShutdownWaitsForAssetCatalogBeforeClosingDatabase(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	assetCatalog := service.NewAssetCatalogService(database, DefaultTestLogger(t))
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	createDone := make(chan appAssetTagCreateResult, 1)
	go func() {
		tag, createErr := assetCatalog.CreateTag(model.AssetTagInput{Name: "shutdown", ColorToken: model.AssetColorBlue})
		createDone <- appAssetTagCreateResult{tag: tag, err: createErr}
	}()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+1)

	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, AssetCatalog: assetCatalog, logger: DefaultTestLogger(t)}).Shutdown()
		close(shutdownDone)
	}()
	select {
	case <-shutdownDone:
		t.Fatal("app shutdown returned before the active asset mutation completed")
	case <-time.After(50 * time.Millisecond):
	}
	rollback()
	result := <-createDone
	require.NoError(t, result.err)
	assert.Equal(t, "shutdown", result.tag.Name)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("app shutdown did not finish after the asset mutation completed")
	}
	assert.Error(t, database.Ping())
	_, err = assetCatalog.ListTags()
	require.ErrorContains(t, err, "asset catalog service is shutting down")
}
