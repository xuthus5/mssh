package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

type assetTagCreateResult struct {
	tag *model.AssetTag
	err error
}

func TestAssetCatalogShutdownWaitsForActiveMutation(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewAssetCatalogService(database, testutil.NewTestLogger())
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	createDone := make(chan assetTagCreateResult, 1)
	go func() {
		tag, err := service.CreateTag(model.AssetTagInput{Name: "shutdown", ColorToken: model.AssetColorBlue})
		createDone <- assetTagCreateResult{tag: tag, err: err}
	}()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+1)

	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()
	assertAssetShutdownPending(t, shutdownDone)
	rollback()
	result := <-createDone
	require.NoError(t, result.err)
	assert.Equal(t, "shutdown", result.tag.Name)
	assertAssetShutdownCompleted(t, shutdownDone)
	require.NoError(t, database.Ping())
}

func TestAssetCatalogRejectsAllOperationsAfterShutdown(t *testing.T) {
	service := NewAssetCatalogService(testutil.NewTestDB(t), testutil.NewTestLogger())
	service.Shutdown()
	service.Shutdown()

	_, err := service.ListEnvironments()
	assertAssetCatalogStopped(t, err)
	_, err = service.ListProjects()
	assertAssetCatalogStopped(t, err)
	_, err = service.ListTags()
	assertAssetCatalogStopped(t, err)
	_, err = service.CreateEnvironment(model.AssetEnvironmentInput{})
	assertAssetCatalogStopped(t, err)
	assertAssetCatalogStopped(t, service.UpdateEnvironment(model.AssetEnvironmentInput{}))
	_, err = service.CreateProject(model.AssetProjectInput{})
	assertAssetCatalogStopped(t, err)
	assertAssetCatalogStopped(t, service.UpdateProject(model.AssetProjectInput{}))
	_, err = service.CreateTag(model.AssetTagInput{})
	assertAssetCatalogStopped(t, err)
	assertAssetCatalogStopped(t, service.UpdateTag(model.AssetTagInput{}))
	_, err = service.GetSessionAssetDetail(0)
	assertAssetCatalogStopped(t, err)
	_, err = service.EnvironmentDeleteImpact(0)
	assertAssetCatalogStopped(t, err)
	_, err = service.ProjectDeleteImpact(0)
	assertAssetCatalogStopped(t, err)
	_, err = service.TagDeleteImpact(0)
	assertAssetCatalogStopped(t, err)
	assertAssetCatalogStopped(t, service.DeleteEnvironment(model.AssetDeleteInput{}))
	assertAssetCatalogStopped(t, service.DeleteProject(model.AssetDeleteInput{}))
	assertAssetCatalogStopped(t, service.DeleteTag(0))
	_, err = service.BulkSetEnvironment(model.BulkAssetAssignmentInput{})
	assertAssetCatalogStopped(t, err)
	_, err = service.BulkSetProject(model.BulkAssetAssignmentInput{})
	assertAssetCatalogStopped(t, err)
	_, err = service.BulkUpdateTags(model.BulkTagUpdateInput{})
	assertAssetCatalogStopped(t, err)
	assertAssetCatalogStopped(t, service.ReorderEnvironments(nil))
	assertAssetCatalogStopped(t, service.ReorderProjects(nil))
}

func TestAssetCatalogShutdownHandlesNilReceiver(t *testing.T) {
	var service *AssetCatalogService
	assert.NotPanics(t, service.Shutdown)
	_, err := service.ListEnvironments()
	assertAssetCatalogStopped(t, err)
}

func assertAssetShutdownPending(t *testing.T, shutdownDone <-chan struct{}) {
	t.Helper()
	select {
	case <-shutdownDone:
		t.Fatal("asset catalog shutdown returned before the active mutation completed")
	case <-time.After(50 * time.Millisecond):
	}
}

func assertAssetShutdownCompleted(t *testing.T, shutdownDone <-chan struct{}) {
	t.Helper()
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("asset catalog shutdown did not finish after the mutation completed")
	}
}

func assertAssetCatalogStopped(t *testing.T, err error) {
	t.Helper()
	require.Error(t, err)
	assert.ErrorContains(t, err, "asset catalog service is shutting down")
}
