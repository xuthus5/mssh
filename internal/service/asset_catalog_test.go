package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestAssetCatalogCRUDAndValidation(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewAssetCatalogService(db, testutil.NewTestLogger())

	environment, err := svc.CreateEnvironment(model.AssetEnvironmentInput{Name: " 生产 ", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	assert.Equal(t, "生产", environment.Name)
	_, err = svc.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorBlue})
	require.Error(t, err)

	project, err := svc.CreateProject(model.AssetProjectInput{Name: "支付平台", Code: "PAY", Description: "核心支付"})
	require.NoError(t, err)
	assert.Equal(t, "PAY", project.Code)
	_, err = svc.CreateProject(model.AssetProjectInput{Name: "另一个项目", Code: "pay"})
	require.Error(t, err)

	tag, err := svc.CreateTag(model.AssetTagInput{Name: "数据库", ColorToken: model.AssetColorBlue})
	require.NoError(t, err)
	require.NoError(t, svc.UpdateTag(model.AssetTagInput{ID: tag.ID, Name: "核心数据库", ColorToken: model.AssetColorViolet}))
	tags, err := svc.ListTags()
	require.NoError(t, err)
	require.Len(t, tags, 1)
	assert.Equal(t, "核心数据库", tags[0].Name)

	require.Error(t, svc.UpdateEnvironment(model.AssetEnvironmentInput{ID: environment.ID, Name: "", ColorToken: model.AssetColorRed}))
	_, err = svc.CreateTag(model.AssetTagInput{Name: "非法颜色", ColorToken: "unknown"})
	require.Error(t, err)
}

func TestAssetCatalogSessionAssignmentAndDetail(t *testing.T) {
	db := testutil.NewTestDB(t)
	catalog := NewAssetCatalogService(db, testutil.NewTestLogger())
	environment, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	project, err := catalog.CreateProject(model.AssetProjectInput{Name: "支付", Code: "PAY"})
	require.NoError(t, err)
	tag, err := catalog.CreateTag(model.AssetTagInput{Name: "数据库", ColorToken: model.AssetColorBlue})
	require.NoError(t, err)

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	created, err := sessionSvc.CreateSession(model.SessionInput{Name: "db", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, EnvironmentID: &environment.ID, ProjectID: &project.ID, TagIDs: []int64{tag.ID}})
	require.NoError(t, err)
	detail, err := catalog.GetSessionAssetDetail(created.ID)
	require.NoError(t, err)
	require.NotNil(t, detail.Environment)
	require.NotNil(t, detail.Project)
	assert.Equal(t, "生产", detail.Environment.Name)
	assert.Equal(t, "PAY", detail.Project.Code)
	require.Len(t, detail.Tags, 1)
	assert.Equal(t, "数据库", detail.Tags[0].Name)
}

func createAssetSession(t *testing.T, dbSession *SessionService, name string, environmentID, projectID *int64, tagIDs []int64) *model.Session {
	t.Helper()
	created, err := dbSession.CreateSession(model.SessionInput{Name: name, Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, EnvironmentID: environmentID, ProjectID: projectID, TagIDs: tagIDs})
	require.NoError(t, err)
	return created
}
