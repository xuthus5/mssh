package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAssetCatalogErrorPaths(t *testing.T) {
	t.Run("closed database", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		service := NewAssetCatalogService(db, testutil.NewTestLogger())
		require.NoError(t, db.Close())
		_, err := service.ListEnvironments()
		require.Error(t, err)
		_, err = service.ListProjects()
		require.Error(t, err)
		_, err = service.ListTags()
		require.Error(t, err)
		_, err = service.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
		require.Error(t, err)
		_, err = service.CreateProject(model.AssetProjectInput{Name: "项目"})
		require.Error(t, err)
		_, err = service.CreateTag(model.AssetTagInput{Name: "标签", ColorToken: model.AssetColorBlue})
		require.Error(t, err)
		require.Error(t, service.UpdateTag(model.AssetTagInput{ID: 1, Name: "标签", ColorToken: model.AssetColorBlue}))
		require.Error(t, service.DeleteTag(1))
		_, err = service.BulkUpdateTags(model.BulkTagUpdateInput{SessionIDs: []int64{1}, Operation: "replace"})
		require.Error(t, err)
		require.Error(t, service.ReorderProjects([]int64{1}))
	})

	t.Run("invalid project fields and missing records", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		service := NewAssetCatalogService(db, testutil.NewTestLogger())
		_, err := service.CreateProject(model.AssetProjectInput{Name: "项目", Code: strings.Repeat("x", 25)})
		assert.ErrorContains(t, err, "project code")
		_, err = service.CreateProject(model.AssetProjectInput{Name: "项目", Description: strings.Repeat("x", 501)})
		assert.ErrorContains(t, err, "project description")
		require.Error(t, service.UpdateEnvironment(model.AssetEnvironmentInput{ID: 999, Name: "不存在", ColorToken: model.AssetColorRed}))
		require.Error(t, service.UpdateProject(model.AssetProjectInput{ID: 999, Name: "不存在"}))
		require.Error(t, service.UpdateTag(model.AssetTagInput{ID: 999, Name: "不存在", ColorToken: model.AssetColorBlue}))
		_, err = service.GetSessionAssetDetail(999)
		require.Error(t, err)
		_, err = service.environment(999)
		require.Error(t, err)
		_, err = service.project(999)
		require.Error(t, err)
		_, err = service.tag(999)
		require.Error(t, err)
	})

	t.Run("duplicate creates and updates", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		service := NewAssetCatalogService(db, testutil.NewTestLogger())
		firstEnvironment, err := service.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
		require.NoError(t, err)
		secondEnvironment, err := service.CreateEnvironment(model.AssetEnvironmentInput{Name: "测试", ColorToken: model.AssetColorAmber})
		require.NoError(t, err)
		firstProject, err := service.CreateProject(model.AssetProjectInput{Name: "支付", Code: "PAY"})
		require.NoError(t, err)
		secondProject, err := service.CreateProject(model.AssetProjectInput{Name: "订单", Code: "ORDER"})
		require.NoError(t, err)
		firstTag, err := service.CreateTag(model.AssetTagInput{Name: "核心", ColorToken: model.AssetColorBlue})
		require.NoError(t, err)
		secondTag, err := service.CreateTag(model.AssetTagInput{Name: "Linux", ColorToken: model.AssetColorGreen})
		require.NoError(t, err)

		_, err = service.CreateProject(model.AssetProjectInput{Name: "支付", Code: "OTHER"})
		require.Error(t, err)
		_, err = service.CreateTag(model.AssetTagInput{Name: "核心", ColorToken: model.AssetColorRed})
		require.Error(t, err)
		require.Error(t, service.UpdateEnvironment(model.AssetEnvironmentInput{ID: secondEnvironment.ID, Name: firstEnvironment.Name, ColorToken: model.AssetColorAmber}))
		require.Error(t, service.UpdateProject(model.AssetProjectInput{ID: secondProject.ID, Name: secondProject.Name, Code: firstProject.Code}))
		require.Error(t, service.UpdateTag(model.AssetTagInput{ID: secondTag.ID, Name: firstTag.Name, ColorToken: model.AssetColorGreen}))
	})

	t.Run("audit failure rolls back create and reorder", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		service := NewAssetCatalogService(db, testutil.NewTestLogger())
		_, err := db.Exec(`INSERT INTO settings (key, namespace, value, value_type, version) VALUES (?, 'audit', 'invalid', 'boolean', 1)`, store.AuditEnabledSetting)
		require.NoError(t, err)
		_, err = service.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
		require.Error(t, err)
		items, listErr := service.ListEnvironments()
		require.NoError(t, listErr)
		assert.Empty(t, items)

		require.NoError(t, store.SetAuditEnabled(db, false))
		first, err := service.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed, SortOrder: 0})
		require.NoError(t, err)
		second, err := service.CreateEnvironment(model.AssetEnvironmentInput{Name: "测试", ColorToken: model.AssetColorAmber, SortOrder: 1})
		require.NoError(t, err)
		_, err = db.Exec("UPDATE settings SET value='invalid' WHERE key=?", store.AuditEnabledSetting)
		require.NoError(t, err)
		require.Error(t, service.ReorderEnvironments([]int64{second.ID, first.ID}))
		items, err = service.ListEnvironments()
		require.NoError(t, err)
		assert.Equal(t, first.ID, items[0].ID)
	})

	t.Run("audit failure rolls back updates deletes and bulk changes", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		service := NewAssetCatalogService(db, testutil.NewTestLogger())
		sessions := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
		require.NoError(t, store.SetAuditEnabled(db, false))
		environment, err := service.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
		require.NoError(t, err)
		project, err := service.CreateProject(model.AssetProjectInput{Name: "支付"})
		require.NoError(t, err)
		tag, err := service.CreateTag(model.AssetTagInput{Name: "核心", ColorToken: model.AssetColorBlue})
		require.NoError(t, err)
		created := createAssetSession(t, sessions, "server", &environment.ID, &project.ID, []int64{tag.ID})
		_, err = db.Exec("UPDATE settings SET value='invalid' WHERE key=?", store.AuditEnabledSetting)
		require.NoError(t, err)

		require.Error(t, service.UpdateEnvironment(model.AssetEnvironmentInput{ID: environment.ID, Name: "已修改", ColorToken: model.AssetColorGreen}))
		require.Error(t, service.UpdateProject(model.AssetProjectInput{ID: project.ID, Name: "已修改"}))
		require.Error(t, service.UpdateTag(model.AssetTagInput{ID: tag.ID, Name: "已修改", ColorToken: model.AssetColorGreen}))
		require.Error(t, service.DeleteTag(tag.ID))
		require.Error(t, service.DeleteProject(model.AssetDeleteInput{ID: project.ID, Mode: "clear"}))
		_, err = service.BulkSetEnvironment(model.BulkAssetAssignmentInput{SessionIDs: []int64{created.ID}, TargetID: nil})
		require.Error(t, err)

		item, err := store.GetSession(db, created.ID)
		require.NoError(t, err)
		assert.Equal(t, environment.ID, *item.EnvironmentID)
		assert.Equal(t, project.ID, *item.ProjectID)
		require.Len(t, item.Tags, 1)
		assert.Equal(t, tag.ID, item.Tags[0].ID)
	})
}

func TestAssetCatalogMutationErrorPaths(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAssetCatalogService(db, testutil.NewTestLogger())
	sessionService := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	environment, err := service.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	project, err := service.CreateProject(model.AssetProjectInput{Name: "支付"})
	require.NoError(t, err)
	tag, err := service.CreateTag(model.AssetTagInput{Name: "核心", ColorToken: model.AssetColorBlue})
	require.NoError(t, err)
	created := createAssetSession(t, sessionService, "server", &environment.ID, &project.ID, []int64{tag.ID})

	impact, err := service.ProjectDeleteImpact(project.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, impact.SessionCount)
	_, err = service.ProjectDeleteImpact(999)
	require.Error(t, err)
	_, err = service.TagDeleteImpact(999)
	require.Error(t, err)
	require.Error(t, service.DeleteEnvironment(model.AssetDeleteInput{ID: environment.ID, Mode: "invalid"}))
	require.Error(t, service.DeleteEnvironment(model.AssetDeleteInput{ID: environment.ID, Mode: "migrate"}))
	require.Error(t, service.DeleteEnvironment(model.AssetDeleteInput{ID: environment.ID, Mode: "migrate", ReplacementID: &environment.ID}))
	require.Error(t, service.DeleteTag(999))

	_, err = service.BulkSetEnvironment(model.BulkAssetAssignmentInput{})
	require.Error(t, err)
	_, err = service.BulkSetEnvironment(model.BulkAssetAssignmentInput{SessionIDs: []int64{created.ID}, TargetID: int64Pointer(999)})
	require.Error(t, err)
	_, err = service.BulkUpdateTags(model.BulkTagUpdateInput{SessionIDs: []int64{created.ID}, Operation: "replace"})
	require.NoError(t, err)
	item, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Empty(t, item.Tags)
	require.Error(t, service.ReorderProjects([]int64{0}))
}

func int64Pointer(value int64) *int64 { return &value }
