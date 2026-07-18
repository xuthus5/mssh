package service

import (
	"database/sql"
	"encoding/csv"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSessionService_ExportCSV(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	parent, err := service.CreateFolder("基础设施", nil)
	require.NoError(t, err)
	child, err := service.CreateFolder("生产/核心", &parent.ID)
	require.NoError(t, err)
	environment, project, tag := createCSVAssets(t, db)
	session, err := service.CreateSession(model.SessionInput{
		FolderID: &child.ID, Name: "=生产服务器", Host: "192.168.1.48", Port: 22, Username: "root",
		Notes: "主库,禁止重启", EnvironmentID: &environment.ID, ProjectID: &project.ID, TagIDs: []int64{tag.ID},
		AuthMethod: model.AuthPassword, Password: "secret", KeepAlive: 60, TermType: "xterm-256color",
	})
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "sessions.csv")

	result, err := service.ExportCSV(path, model.SessionCSVExportOptions{SessionIDs: []int64{session.ID}})
	require.NoError(t, err)
	assert.Equal(t, 1, result.Count)
	assert.False(t, result.IncludedPasswords)
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(string(content), "\ufeff"))
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())

	records := readCSVFixture(t, content)
	assert.Equal(t, sessionCSVHeader, records[0])
	row := csvRowMap(records[0], records[1])
	assert.Equal(t, "'=生产服务器", row["name"])
	assert.Empty(t, row["password"])
	assert.JSONEq(t, `["基础设施","生产/核心"]`, row["folder_path"])
	assert.JSONEq(t, `["关键,节点"]`, row["tags"])
}

func TestSessionService_ImportCSVCreatesMetadataAndHandlesConflicts(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	key, err := store.CreateKey(db, model.SSHKey{Name: "deploy", Type: model.KeyTypeED25519, PrivateKey: "private", PublicKey: "ssh-ed25519 AAAA deploy"})
	require.NoError(t, err)
	path := writeSessionCSVFixture(t, []map[string]string{
		csvFixtureRow(map[string]string{"name": "生产服务器", "password": "secret", "folder_path": `["基础设施","生产"]`, "environment": "生产", "project": "MSSH", "tags": `["核心","Linux"]`, "notes": "first"}),
		csvFixtureRow(map[string]string{"name": "密钥服务器", "host": "10.0.0.8", "auth_method": "key", "key_name": key.Name, "key_public_key": key.PublicKey}),
	})

	summary, err := service.ImportCSV(path, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictSkip})
	require.NoError(t, err)
	assert.Equal(t, 2, summary.Imported)
	assert.Zero(t, summary.Failed)
	sessions, err := store.ListSessions(db, nil)
	require.NoError(t, err)
	require.Len(t, sessions, 2)
	assert.Equal(t, "生产", sessions[0].Environment.Name)
	assert.Equal(t, "MSSH", sessions[0].Project.Name)
	assert.ElementsMatch(t, []string{"Linux", "核心"}, []string{sessions[0].Tags[0].Name, sessions[0].Tags[1].Name})

	skip, err := service.ImportCSV(path, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictSkip})
	require.NoError(t, err)
	assert.Equal(t, 2, skip.Skipped)
	missingKeyDuplicate := writeSessionCSVFixture(t, []map[string]string{csvFixtureRow(map[string]string{
		"name": "密钥服务器", "host": "10.0.0.8", "auth_method": "key", "key_name": "missing",
	})})
	skippedKey, err := service.ImportCSV(missingKeyDuplicate, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictSkip})
	require.NoError(t, err)
	assert.Equal(t, 1, skippedKey.Skipped)
	overwritePath := writeSessionCSVFixture(t, []map[string]string{csvFixtureRow(map[string]string{
		"name": "生产服务器", "notes": "updated", "folder_path": `["基础设施","生产"]`,
		"environment": "生产", "project": "MSSH", "tags": `["核心","核心","Linux"]`,
	})})
	overwrite, err := service.ImportCSV(overwritePath, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictOverwrite})
	require.NoError(t, err)
	assert.Equal(t, 1, overwrite.Updated)
	updated, err := store.GetSession(db, sessions[0].ID)
	require.NoError(t, err)
	assert.Equal(t, "updated", updated.Notes)
	assert.Equal(t, "secret", updated.Password)
}

func TestSessionService_ImportCSVReportsRowFailuresAndRejectsUnsafeFiles(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	path := writeSessionCSVFixture(t, []map[string]string{
		csvFixtureRow(map[string]string{"name": "有效会话"}),
		csvFixtureRow(map[string]string{"name": "无效端口", "port": "70000"}),
		csvFixtureRow(map[string]string{"name": "缺少密钥", "auth_method": "key", "key_name": "missing"}),
	})

	summary, err := service.ImportCSV(path, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictSkip})
	require.NoError(t, err)
	assert.Equal(t, 1, summary.Imported)
	assert.Equal(t, 2, summary.Failed)
	assert.Contains(t, summary.Results[1].Error, "port")
	assert.Contains(t, summary.Results[2].Error, "key")

	oversized := filepath.Join(t.TempDir(), "oversized.csv")
	require.NoError(t, os.WriteFile(oversized, make([]byte, maxSessionCSVBytes+1), 0o600))
	_, err = service.ImportCSV(oversized, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictSkip})
	assert.ErrorContains(t, err, "exceeds")
	invalidUTF8 := filepath.Join(t.TempDir(), "invalid.csv")
	require.NoError(t, os.WriteFile(invalidUTF8, []byte{0xff, 0xfe, 0xfd}, 0o600))
	_, err = service.ImportCSV(invalidUTF8, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictSkip})
	assert.ErrorContains(t, err, "UTF-8")
	_, err = service.ImportCSV(path, model.SessionCSVImportOptions{ConflictPolicy: "invalid"})
	assert.ErrorContains(t, err, "conflict policy")
}

func createCSVAssets(t *testing.T, db *sql.DB) (*model.AssetEnvironment, *model.AssetProject, *model.AssetTag) {
	t.Helper()
	catalog := NewAssetCatalogService(db, testutil.NewTestLogger())
	environment, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	project, err := catalog.CreateProject(model.AssetProjectInput{Name: "MSSH"})
	require.NoError(t, err)
	tag, err := catalog.CreateTag(model.AssetTagInput{Name: "关键,节点", ColorToken: model.AssetColorAmber})
	require.NoError(t, err)
	return environment, project, tag
}

func readCSVFixture(t *testing.T, content []byte) [][]string {
	t.Helper()
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(content), "\ufeff")))
	records, err := reader.ReadAll()
	require.NoError(t, err)
	return records
}

func csvRowMap(header, row []string) map[string]string {
	result := make(map[string]string, len(header))
	for index, name := range header {
		result[name] = row[index]
	}
	return result
}

func writeSessionCSVFixture(t *testing.T, rows []map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "sessions.csv")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)
	_, err = file.WriteString("\ufeff")
	require.NoError(t, err)
	writer := csv.NewWriter(file)
	require.NoError(t, writer.Write(sessionCSVHeader))
	for _, row := range rows {
		record := make([]string, len(sessionCSVHeader))
		for index, name := range sessionCSVHeader {
			record[index] = row[name]
		}
		require.NoError(t, writer.Write(record))
	}
	writer.Flush()
	require.NoError(t, writer.Error())
	require.NoError(t, file.Close())
	return path
}

func csvFixtureRow(overrides map[string]string) map[string]string {
	row := map[string]string{
		"format_version": "1", "name": "会话", "host": "10.0.0.1", "port": "22", "username": "root",
		"auth_method": "password", "folder_path": `[]`, "tags": `[]`, "keep_alive": "30", "term_type": "xterm-256color",
	}
	for key, value := range overrides {
		row[key] = value
	}
	return row
}
