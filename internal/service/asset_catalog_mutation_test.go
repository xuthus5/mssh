package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAssetCatalogDeleteMigrationAndClear(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, store.SetAuditEnabled(db, true))
	catalog := NewAssetCatalogService(db, testutil.NewTestLogger())
	sessions := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	production, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	testEnvironment, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "测试", ColorToken: model.AssetColorAmber})
	require.NoError(t, err)
	first := createAssetSession(t, sessions, "first", &production.ID, nil, nil)
	second := createAssetSession(t, sessions, "second", &production.ID, nil, nil)

	impact, err := catalog.EnvironmentDeleteImpact(production.ID)
	require.NoError(t, err)
	assert.Equal(t, 2, impact.SessionCount)
	require.NoError(t, catalog.DeleteEnvironment(model.AssetDeleteInput{ID: production.ID, Mode: "migrate", ReplacementID: &testEnvironment.ID}))
	for _, id := range []int64{first.ID, second.ID} {
		item, getErr := store.GetSession(db, id)
		require.NoError(t, getErr)
		assert.Equal(t, testEnvironment.ID, *item.EnvironmentID)
	}

	project, err := catalog.CreateProject(model.AssetProjectInput{Name: "支付"})
	require.NoError(t, err)
	third := createAssetSession(t, sessions, "third", nil, &project.ID, nil)
	require.NoError(t, catalog.DeleteProject(model.AssetDeleteInput{ID: project.ID, Mode: "clear"}))
	item, err := store.GetSession(db, third.ID)
	require.NoError(t, err)
	assert.Nil(t, item.ProjectID)

	audit, err := store.ListAuditEvents(db, model.AuditFilter{Limit: 20})
	require.NoError(t, err)
	assert.NotEmpty(t, audit)
}

func TestAssetCatalogDeleteRollbackOnInvalidReplacement(t *testing.T) {
	db := testutil.NewTestDB(t)
	catalog := NewAssetCatalogService(db, testutil.NewTestLogger())
	sessions := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	environment, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	created := createAssetSession(t, sessions, "server", &environment.ID, nil, nil)
	missing := int64(999)

	err = catalog.DeleteEnvironment(model.AssetDeleteInput{ID: environment.ID, Mode: "migrate", ReplacementID: &missing})
	require.Error(t, err)
	item, getErr := store.GetSession(db, created.ID)
	require.NoError(t, getErr)
	assert.Equal(t, environment.ID, *item.EnvironmentID)
	environments, listErr := catalog.ListEnvironments()
	require.NoError(t, listErr)
	assert.Len(t, environments, 1)
}

func TestAssetCatalogTagDeleteAndBulkOperations(t *testing.T) {
	db := testutil.NewTestDB(t)
	catalog := NewAssetCatalogService(db, testutil.NewTestLogger())
	sessions := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	databaseTag, err := catalog.CreateTag(model.AssetTagInput{Name: "数据库", ColorToken: model.AssetColorBlue})
	require.NoError(t, err)
	coreTag, err := catalog.CreateTag(model.AssetTagInput{Name: "核心", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	linuxTag, err := catalog.CreateTag(model.AssetTagInput{Name: "Linux", ColorToken: model.AssetColorGreen})
	require.NoError(t, err)
	first := createAssetSession(t, sessions, "first", nil, nil, []int64{databaseTag.ID})
	second := createAssetSession(t, sessions, "second", nil, nil, nil)
	ids := []int64{first.ID, second.ID}

	count, err := catalog.BulkUpdateTags(model.BulkTagUpdateInput{SessionIDs: ids, TagIDs: []int64{coreTag.ID}, Operation: "add"})
	require.NoError(t, err)
	assert.Equal(t, 2, count)
	_, err = catalog.BulkUpdateTags(model.BulkTagUpdateInput{SessionIDs: ids, TagIDs: []int64{databaseTag.ID}, Operation: "remove"})
	require.NoError(t, err)
	_, err = catalog.BulkUpdateTags(model.BulkTagUpdateInput{SessionIDs: ids, TagIDs: []int64{linuxTag.ID}, Operation: "replace"})
	require.NoError(t, err)
	for _, id := range ids {
		item, getErr := store.GetSession(db, id)
		require.NoError(t, getErr)
		require.Len(t, item.Tags, 1)
		assert.Equal(t, linuxTag.ID, item.Tags[0].ID)
	}

	impact, err := catalog.TagDeleteImpact(linuxTag.ID)
	require.NoError(t, err)
	assert.Equal(t, 2, impact.SessionCount)
	require.NoError(t, catalog.DeleteTag(linuxTag.ID))
	item, err := store.GetSession(db, first.ID)
	require.NoError(t, err)
	assert.Empty(t, item.Tags)
}

func TestAssetCatalogBulkAssignmentAndReorder(t *testing.T) {
	db := testutil.NewTestDB(t)
	catalog := NewAssetCatalogService(db, testutil.NewTestLogger())
	sessions := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	firstEnvironment, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	secondEnvironment, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "测试", ColorToken: model.AssetColorAmber})
	require.NoError(t, err)
	firstProject, err := catalog.CreateProject(model.AssetProjectInput{Name: "支付", SortOrder: 0})
	require.NoError(t, err)
	secondProject, err := catalog.CreateProject(model.AssetProjectInput{Name: "订单", SortOrder: 1})
	require.NoError(t, err)
	first := createAssetSession(t, sessions, "first", nil, nil, nil)
	second := createAssetSession(t, sessions, "second", nil, nil, nil)

	count, err := catalog.BulkSetEnvironment(model.BulkAssetAssignmentInput{SessionIDs: []int64{first.ID, second.ID}, TargetID: &firstEnvironment.ID})
	require.NoError(t, err)
	assert.Equal(t, 2, count)
	require.NoError(t, catalog.ReorderEnvironments([]int64{secondEnvironment.ID, firstEnvironment.ID}))
	environments, err := catalog.ListEnvironments()
	require.NoError(t, err)
	require.Len(t, environments, 2)
	assert.Equal(t, secondEnvironment.ID, environments[0].ID)
	count, err = catalog.BulkSetProject(model.BulkAssetAssignmentInput{SessionIDs: []int64{first.ID, second.ID}, TargetID: &firstProject.ID})
	require.NoError(t, err)
	assert.Equal(t, 2, count)
	require.NoError(t, catalog.ReorderProjects([]int64{secondProject.ID, firstProject.ID}))
	projects, err := catalog.ListProjects()
	require.NoError(t, err)
	assert.Equal(t, secondProject.ID, projects[0].ID)

	_, err = catalog.BulkSetEnvironment(model.BulkAssetAssignmentInput{SessionIDs: []int64{first.ID}, TargetID: nil})
	require.NoError(t, err)
	_, err = catalog.BulkSetProject(model.BulkAssetAssignmentInput{SessionIDs: []int64{first.ID}, TargetID: nil})
	require.NoError(t, err)
	item, err := store.GetSession(db, first.ID)
	require.NoError(t, err)
	assert.Nil(t, item.EnvironmentID)
	assert.Nil(t, item.ProjectID)
}

func TestAssetCatalogMutationValidationAndRollback(t *testing.T) {
	db := testutil.NewTestDB(t)
	catalog := NewAssetCatalogService(db, testutil.NewTestLogger())
	sessions := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	firstEnvironment, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	secondEnvironment, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "测试", ColorToken: model.AssetColorAmber})
	require.NoError(t, err)
	created := createAssetSession(t, sessions, "server", &firstEnvironment.ID, nil, nil)
	before, err := catalog.ListEnvironments()
	require.NoError(t, err)

	require.Error(t, catalog.ReorderEnvironments([]int64{secondEnvironment.ID}))
	environments, err := catalog.ListEnvironments()
	require.NoError(t, err)
	assert.Equal(t, []int64{before[0].ID, before[1].ID}, []int64{environments[0].ID, environments[1].ID})

	_, err = catalog.BulkSetEnvironment(model.BulkAssetAssignmentInput{SessionIDs: []int64{created.ID, 999}, TargetID: &secondEnvironment.ID})
	require.Error(t, err)
	item, getErr := store.GetSession(db, created.ID)
	require.NoError(t, getErr)
	assert.Equal(t, firstEnvironment.ID, *item.EnvironmentID)

	_, err = catalog.BulkUpdateTags(model.BulkTagUpdateInput{SessionIDs: []int64{created.ID}, Operation: "invalid"})
	require.Error(t, err)
	_, err = catalog.BulkUpdateTags(model.BulkTagUpdateInput{SessionIDs: []int64{created.ID}, TagIDs: []int64{999}, Operation: "add"})
	require.Error(t, err)
}

func TestAssetCatalogChangesAreAudited(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, store.SetAuditEnabled(db, true))
	catalog := NewAssetCatalogService(db, testutil.NewTestLogger())
	first, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	second, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "测试", ColorToken: model.AssetColorAmber})
	require.NoError(t, err)
	require.NoError(t, catalog.UpdateEnvironment(model.AssetEnvironmentInput{ID: first.ID, Name: "核心生产", ColorToken: model.AssetColorViolet, SortOrder: 0}))
	require.NoError(t, catalog.ReorderEnvironments([]int64{second.ID, first.ID}))
	project, err := catalog.CreateProject(model.AssetProjectInput{Name: "支付", Code: "PAY"})
	require.NoError(t, err)
	require.NoError(t, catalog.UpdateProject(model.AssetProjectInput{ID: project.ID, Name: "支付平台", Code: "PAY", Description: "核心", SortOrder: 0}))
	tag, err := catalog.CreateTag(model.AssetTagInput{Name: "数据库", ColorToken: model.AssetColorBlue})
	require.NoError(t, err)
	require.NoError(t, catalog.UpdateTag(model.AssetTagInput{ID: tag.ID, Name: "核心数据库", ColorToken: model.AssetColorViolet}))

	events, err := store.ListAuditEvents(db, model.AuditFilter{Limit: 20})
	require.NoError(t, err)
	actions := make(map[string]bool)
	targets := make(map[string]bool)
	for _, event := range events {
		targets[event.TargetType] = true
		if event.TargetType == "asset_environment" {
			actions[event.Action] = true
		}
	}
	assert.True(t, actions["create"])
	assert.True(t, actions["update"])
	assert.True(t, actions["reorder"])
	assert.True(t, targets["asset_project"])
	assert.True(t, targets["asset_tag"])
}
