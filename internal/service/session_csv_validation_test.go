package service

import (
	"encoding/json"
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

func TestSessionCSVCellAndAssetHelpers(t *testing.T) {
	assert.Equal(t, "'=value", protectCSVCell("=value"))
	assert.Equal(t, "normal", protectCSVCell("normal"))
	assert.Equal(t, "=value", restoreCSVCell("'=value"))
	assert.Equal(t, "'normal", restoreCSVCell("'normal"))
	assert.Empty(t, assetName(nil))
	assert.Equal(t, "'@prod", assetName(&model.AssetEnvironment{Name: "@prod"}))
	assert.Empty(t, assetProjectName(nil))
	assert.Equal(t, "project", assetProjectName(&model.AssetProject{Name: "project"}))
	selectQuery, insertQuery := sessionCSVAssetQueries("project")
	assert.Contains(t, selectQuery, "asset_projects")
	assert.Contains(t, insertQuery, "asset_projects")
	selectQuery, insertQuery = sessionCSVAssetQueries("environment")
	assert.Contains(t, selectQuery, "asset_environments")
	assert.Contains(t, insertQuery, "asset_environments")
}

func TestSessionCSVHeaderAndRecordValidation(t *testing.T) {
	columns, err := sessionCSVColumns(sessionCSVHeader)
	require.NoError(t, err)
	valid := csvFixtureRow(nil)
	valid["name"] = "'=公式会话"
	record, err := parseSessionCSVRecord(2, columns, csvFixtureValues(valid))
	require.NoError(t, err)
	assert.Equal(t, "=公式会话", record.Name)

	invalidHeaders := []struct {
		name   string
		header []string
	}{
		{name: "empty", header: []string{""}},
		{name: "duplicate", header: append(append([]string{}, sessionCSVHeader...), "name")},
		{name: "missing", header: sessionCSVHeader[1:]},
	}
	for _, test := range invalidHeaders {
		t.Run(test.name, func(t *testing.T) {
			_, headerErr := sessionCSVColumns(test.header)
			assert.Error(t, headerErr)
		})
	}

	longText := strings.Repeat("x", sessionNotesLimit+1)
	manyFolders, manyTags := make([]string, 33), make([]string, 65)
	for index := range manyFolders {
		manyFolders[index] = "folder"
	}
	for index := range manyTags {
		manyTags[index] = "tag"
	}
	cases := []struct {
		name   string
		values map[string]string
	}{
		{name: "version", values: map[string]string{"format_version": "2"}},
		{name: "port type", values: map[string]string{"port": "ssh"}},
		{name: "port range", values: map[string]string{"port": "70000"}},
		{name: "keep alive", values: map[string]string{"keep_alive": "90000"}},
		{name: "folder json", values: map[string]string{"folder_path": "["}},
		{name: "tag json", values: map[string]string{"tags": "["}},
		{name: "name", values: map[string]string{"name": ""}},
		{name: "host", values: map[string]string{"host": ""}},
		{name: "username", values: map[string]string{"username": ""}},
		{name: "term", values: map[string]string{"term_type": ""}},
		{name: "notes", values: map[string]string{"notes": longText}},
		{name: "folder count", values: map[string]string{"folder_path": mustJSON(t, manyFolders)}},
		{name: "tag count", values: map[string]string{"tags": mustJSON(t, manyTags)}},
		{name: "auth", values: map[string]string{"auth_method": "unknown"}},
		{name: "folder name", values: map[string]string{"folder_path": `[""]`}},
		{name: "tag name", values: map[string]string{"tags": mustJSON(t, []string{strings.Repeat("t", 33)})}},
		{name: "environment", values: map[string]string{"environment": strings.Repeat("e", 65)}},
		{name: "project", values: map[string]string{"project": strings.Repeat("p", 65)}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			row := csvFixtureRow(test.values)
			_, parseErr := parseSessionCSVRecord(3, columns, csvFixtureValues(row))
			assert.Error(t, parseErr)
		})
	}
}

func TestSessionService_ExportCSVIncludesPasswordsAndRejectsInvalidSelection(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	session, err := service.CreateSession(model.SessionInput{
		Name: "server", Host: "host", Port: 22, Username: "root", AuthMethod: model.AuthPassword,
		Password: "secret", KeepAlive: 30, TermType: "xterm-256color",
	})
	require.NoError(t, err)
	key, err := store.CreateKey(db, model.SSHKey{Name: "deploy", Type: model.KeyTypeED25519, PrivateKey: "private", PublicKey: "ssh-ed25519 AAAA deploy"})
	require.NoError(t, err)
	_, err = service.CreateSession(model.SessionInput{
		Name: "key-server", Host: "key-host", Port: 22, Username: "deploy", AuthMethod: model.AuthKey,
		KeyID: &key.ID, KeepAlive: 30, TermType: "xterm-256color",
	})
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "with-password.csv")
	result, err := service.ExportCSV(path, model.SessionCSVExportOptions{IncludePasswords: true})
	require.NoError(t, err)
	assert.Equal(t, 2, result.Count)
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	records := readCSVFixture(t, content)
	rows := map[string]map[string]string{}
	for _, values := range records[1:] {
		row := csvRowMap(records[0], values)
		rows[restoreCSVCell(row["name"])] = row
	}
	assert.Equal(t, "secret", rows["server"]["password"])
	assert.Equal(t, "deploy", rows["key-server"]["key_name"])
	assert.Equal(t, key.PublicKey, rows["key-server"]["key_public_key"])
	keys, err := loadSessionCSVKeys(db)
	require.NoError(t, err)
	assert.Equal(t, key.PublicKey, keys[key.ID].PublicKey)

	_, err = service.ExportCSV(path, model.SessionCSVExportOptions{SessionIDs: []int64{-1}})
	assert.ErrorContains(t, err, "invalid session id")
	_, err = service.ExportCSV(path, model.SessionCSVExportOptions{SessionIDs: []int64{session.ID + 999}})
	assert.ErrorContains(t, err, "not found")
	_, err = buildSessionCSVFolderPath(999, map[int64]model.SessionFolder{}, map[int64]bool{})
	assert.ErrorContains(t, err, "not found")
	_, err = buildSessionCSVFolderPath(1, map[int64]model.SessionFolder{1: {ID: 1, Name: "cycle", ParentID: csvInt64Pointer(1)}}, map[int64]bool{})
	assert.ErrorContains(t, err, "cycle")
	closedDB := testutil.NewTestDB(t)
	require.NoError(t, closedDB.Close())
	_, err = loadSessionCSVKeys(closedDB)
	assert.Error(t, err)
	_, err = loadSessionCSVFolderPaths(closedDB)
	assert.Error(t, err)
}

func TestSessionService_ImportCSVStructuralAndKeyErrors(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	_, err := store.CreateKey(db, model.SSHKey{Name: "duplicate", Type: model.KeyTypeED25519, PrivateKey: "a", PublicKey: "pub-a"})
	require.NoError(t, err)
	_, err = store.CreateKey(db, model.SSHKey{Name: "duplicate", Type: model.KeyTypeED25519, PrivateKey: "b", PublicKey: "pub-b"})
	require.NoError(t, err)
	path := writeSessionCSVFixture(t, []map[string]string{
		csvFixtureRow(map[string]string{"name": "ambiguous", "auth_method": "key", "key_name": "duplicate"}),
		csvFixtureRow(map[string]string{"name": "no-key", "host": "host-2", "auth_method": "key"}),
	})
	summary, err := service.ImportCSV(path, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictSkip})
	require.NoError(t, err)
	assert.Equal(t, 2, summary.Failed)
	assert.Contains(t, summary.Results[0].Error, "ambiguous")
	assert.Contains(t, summary.Results[1].Error, "requires")

	for name, content := range map[string]string{
		"empty": "", "malformed": "\ufeff\"unterminated", "missing": "name,host\nserver,host\n", "duplicate": "name,name\na,b\n",
	} {
		t.Run(name, func(t *testing.T) {
			fixture := filepath.Join(t.TempDir(), name+".csv")
			require.NoError(t, os.WriteFile(fixture, []byte(content), 0o600))
			_, importErr := service.ImportCSV(fixture, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictSkip})
			assert.Error(t, importErr)
		})
	}
}

func TestSessionService_ImportCSVTransactionFailures(t *testing.T) {
	tests := []struct {
		name    string
		trigger string
		prepare func(*testing.T, *SessionService) string
	}{
		{name: "insert", trigger: `CREATE TRIGGER fail_csv_insert BEFORE INSERT ON sessions BEGIN SELECT RAISE(FAIL, 'insert failed'); END`, prepare: func(t *testing.T, _ *SessionService) string {
			return writeSessionCSVFixture(t, []map[string]string{csvFixtureRow(nil)})
		}},
		{name: "tags", trigger: `CREATE TRIGGER fail_csv_tag BEFORE INSERT ON session_tags BEGIN SELECT RAISE(FAIL, 'tag failed'); END`, prepare: func(t *testing.T, _ *SessionService) string {
			return writeSessionCSVFixture(t, []map[string]string{csvFixtureRow(map[string]string{"tags": `["tag"]`})})
		}},
		{name: "folder", trigger: `CREATE TRIGGER fail_csv_folder BEFORE INSERT ON session_folders BEGIN SELECT RAISE(FAIL, 'folder failed'); END`, prepare: func(t *testing.T, _ *SessionService) string {
			return writeSessionCSVFixture(t, []map[string]string{csvFixtureRow(map[string]string{"folder_path": `["new"]`})})
		}},
		{name: "environment", trigger: `CREATE TRIGGER fail_csv_environment BEFORE INSERT ON asset_environments BEGIN SELECT RAISE(FAIL, 'environment failed'); END`, prepare: func(t *testing.T, _ *SessionService) string {
			return writeSessionCSVFixture(t, []map[string]string{csvFixtureRow(map[string]string{"environment": "new"})})
		}},
		{name: "update", trigger: `CREATE TRIGGER fail_csv_update BEFORE UPDATE ON sessions BEGIN SELECT RAISE(FAIL, 'update failed'); END`, prepare: func(t *testing.T, service *SessionService) string {
			_, err := service.CreateSession(model.SessionInput{Name: "会话", Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color"})
			require.NoError(t, err)
			return writeSessionCSVFixture(t, []map[string]string{csvFixtureRow(map[string]string{"notes": "updated"})})
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
			_, err := db.Exec(test.trigger)
			require.NoError(t, err)
			policy := model.SessionCSVConflictSkip
			if test.name == "update" {
				policy = model.SessionCSVConflictOverwrite
			}
			summary, err := service.ImportCSV(test.prepare(t, service), model.SessionCSVImportOptions{ConflictPolicy: policy})
			require.NoError(t, err)
			assert.Equal(t, 1, summary.Failed)
		})
	}
}

func csvFixtureValues(row map[string]string) []string {
	values := make([]string, len(sessionCSVHeader))
	for index, name := range sessionCSVHeader {
		values[index] = row[name]
	}
	return values
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	content, err := json.Marshal(value)
	require.NoError(t, err)
	return string(content)
}

func csvInt64Pointer(value int64) *int64 { return &value }
