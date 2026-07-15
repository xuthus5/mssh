package service

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

const syncTestSessionJSON = `{"name":"s1","host":"10.0.0.1","port":22,"username":"root","auth_method":"password","password":"enc","keep_alive":30,"term_type":"xterm"}`

var syncInvalidDocumentTests = []struct {
	name          string
	document      string
	expectedError string
}{
	{
		name: "missing version", document: `{"sessions":[` + syncTestSessionJSON + `],"keys":[],"macros":[]}`,
		expectedError: "import: validate sync document: format_version must be 1, got 0",
	},
	{
		name: "wrong version", document: `{"format_version":2,"sessions":[` + syncTestSessionJSON + `],"keys":[],"macros":[]}`,
		expectedError: "import: validate sync document: format_version must be 1, got 2",
	},
	{
		name: "null version", document: `{"format_version":null,"sessions":[` + syncTestSessionJSON + `],"keys":[],"macros":[]}`,
		expectedError: "import: decode sync document: format_version must be an integer",
	},
	{
		name: "string version", document: `{"format_version":"1","sessions":[` + syncTestSessionJSON + `],"keys":[],"macros":[]}`,
		expectedError: "import: decode sync document: format_version must be an integer",
	},
	{
		name: "decimal version", document: `{"format_version":1.0,"sessions":[` + syncTestSessionJSON + `],"keys":[],"macros":[]}`,
		expectedError: "import: decode sync document: format_version must be an integer",
	},
	{
		name: "top-level unknown field", document: `{"format_version":1,"sessions":[` + syncTestSessionJSON + `],"keys":[],"macros":[],"unexpected":true}`,
		expectedError: `import: decode sync document: json: unknown field "unexpected"`,
	},
	{
		name: "session unknown field", document: `{"format_version":1,"sessions":[` + syncTestSessionJSON[:len(syncTestSessionJSON)-1] + `,"unexpected":true}],"keys":[],"macros":[]}`,
		expectedError: `import: decode sync document: json: unknown field "unexpected"`,
	},
	{
		name: "key unknown field", document: `{"format_version":1,"sessions":[],"keys":[{"name":"k1","unexpected":true}],"macros":[]}`,
		expectedError: `import: decode sync document: json: unknown field "unexpected"`,
	},
	{
		name: "macro unknown field", document: `{"format_version":1,"sessions":[],"keys":[],"macros":[{"name":"m1","unexpected":true}]}`,
		expectedError: `import: decode sync document: json: unknown field "unexpected"`,
	},
	{
		name: "missing sessions array", document: `{"format_version":1,"keys":[],"macros":[{"name":"m1","command":"ls"}]}`,
		expectedError: "import: validate sync document: sessions array is required",
	},
	{
		name: "null sessions array", document: `{"format_version":1,"sessions":null,"keys":[],"macros":[]}`,
		expectedError: "import: validate sync document: sessions array is required",
	},
	{
		name: "missing keys array", document: `{"format_version":1,"sessions":[` + syncTestSessionJSON + `],"macros":[]}`,
		expectedError: "import: validate sync document: keys array is required",
	},
	{
		name: "null keys array", document: `{"format_version":1,"sessions":[],"keys":null,"macros":[]}`,
		expectedError: "import: validate sync document: keys array is required",
	},
	{
		name: "missing macros array", document: `{"format_version":1,"sessions":[` + syncTestSessionJSON + `],"keys":[]}`,
		expectedError: "import: validate sync document: macros array is required",
	},
	{
		name: "null macros array", document: `{"format_version":1,"sessions":[],"keys":[],"macros":null}`,
		expectedError: "import: validate sync document: macros array is required",
	},
	{
		name: "trailing JSON value", document: `{"format_version":1,"sessions":[` + syncTestSessionJSON + `],"keys":[],"macros":[]} {}`,
		expectedError: "import: decode sync document trailer: trailing JSON value",
	},
}

func TestNewSyncService(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())
	assert.NotNil(t, svc)
}

func TestSyncService_ExportImport(t *testing.T) {
	db := testutil.NewTestDB(t)
	seedSyncExportData(t, db)
	svc := NewSyncService(db, testutil.NewTestLogger())
	exportPath := filepath.Join(t.TempDir(), "export.json")
	err := svc.Export(exportPath)
	require.NoError(t, err)
	assertSyncExportContents(t, exportPath)
	db2 := testutil.NewTestDB(t)
	svc2 := NewSyncService(db2, testutil.NewTestLogger())
	err = svc2.Import(exportPath)
	require.NoError(t, err)
	assertImportedSyncData(t, db2)
}

func seedSyncExportData(t *testing.T, db *sql.DB) {
	t.Helper()
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	keySvc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())
	macroSvc := NewMacroService(db, nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "s1", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)
	assert.NotZero(t, createdSess.ID)
	createdKey, err := keySvc.Generate("k1", model.KeyTypeED25519, 0)
	require.NoError(t, err)
	_ = createdKey
	createdMacro, err := macroSvc.Create(model.MacroInputFrom(model.Macro{Name: "m1", Command: "ls\n"}))
	require.NoError(t, err)
	_ = createdMacro
}

func assertSyncExportContents(t *testing.T, exportPath string) {
	t.Helper()
	data, err := os.ReadFile(exportPath)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"format_version":1`)
	assert.Contains(t, string(data), `"s1"`)
	assert.Contains(t, string(data), `"k1"`)
	assert.Contains(t, string(data), `"m1"`)
}

func assertImportedSyncData(t *testing.T, db *sql.DB) {
	t.Helper()
	s2, err := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger()).ListSessions(nil)
	require.NoError(t, err)
	assert.Len(t, s2, 1)
	assert.Equal(t, "s1", s2[0].Name)

	k2, err := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger()).List()
	require.NoError(t, err)
	assert.Len(t, k2, 1)
	assert.Equal(t, "k1", k2[0].Name)

	m2, err := NewMacroService(db, nil, testutil.NewTestLogger()).List()
	require.NoError(t, err)
	assert.Len(t, m2, 1)
	assert.Equal(t, "m1", m2[0].Name)
}

func TestSyncService_ExportEmpty(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())

	exportPath := filepath.Join(t.TempDir(), "empty.json")
	err := svc.Export(exportPath)
	require.NoError(t, err)

	data, err := os.ReadFile(exportPath)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"format_version":1`)
	assert.Contains(t, string(data), `"sessions":[]`)
	assert.Contains(t, string(data), `"keys":[]`)
	assert.Contains(t, string(data), `"macros":[]`)
}

func TestSyncService_ImportInvalidPath(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())

	err := svc.Import("/nonexistent/import.json")
	assert.Error(t, err)
}

func TestSyncService_ImportInvalidJSON(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())

	badPath := filepath.Join(t.TempDir(), "bad.json")
	require.NoError(t, os.WriteFile(badPath, []byte("not json"), 0o600))

	err := svc.Import(badPath)
	assert.Error(t, err)
}

func TestSyncService_ImportEmptyData(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())

	emptyPath := filepath.Join(t.TempDir(), "empty.json")
	require.NoError(t, os.WriteFile(emptyPath, []byte(`{"format_version":1,"sessions":[],"keys":[],"macros":[]}`), 0o600))

	err := svc.Import(emptyPath)
	assert.NoError(t, err)
}

func TestSyncService_ImportRejectsInvalidDocumentsBeforeWrites(t *testing.T) {
	for _, test := range syncInvalidDocumentTests {
		t.Run(test.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			svc := NewSyncService(db, testutil.NewTestLogger())
			path := filepath.Join(t.TempDir(), "import.json")
			require.NoError(t, os.WriteFile(path, []byte(test.document), 0o600))

			err := svc.Import(path)
			require.Error(t, err)
			assert.ErrorContains(t, err, test.expectedError)
			assertSyncTablesEmpty(t, db)
		})
	}
}

func assertSyncTablesEmpty(t *testing.T, db *sql.DB) {
	t.Helper()
	var count int
	err := db.QueryRow(`
		SELECT
			(SELECT COUNT(*) FROM sessions) +
			(SELECT COUNT(*) FROM ssh_keys) +
			(SELECT COUNT(*) FROM macros)
	`).Scan(&count)
	require.NoError(t, err)
	assert.Zero(t, count)
}

func TestSyncService_ExportToInvalidPath(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())

	err := svc.Export("/nonexistent-dir/export.json")
	assert.Error(t, err)
}

func TestSyncService_SyncToCloud(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())

	err := svc.SyncToCloud()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not implemented")
}

func TestSyncService_SyncFromCloud(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())

	err := svc.SyncFromCloud()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not implemented")
}

func TestSyncService_ExportClosedDB(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())
	db.Close()

	exportPath := filepath.Join(t.TempDir(), "export-closed.json")
	err := svc.Export(exportPath)
	assert.Error(t, err)
}

func TestSyncService_ImportClosedDB(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())
	db.Close()

	importPath := filepath.Join(t.TempDir(), "import-closed.json")
	require.NoError(t, os.WriteFile(importPath, []byte(`{"format_version":1,"sessions":[{"name":"s1","host":"10.0.0.1","port":22,"username":"root","auth_method":"password","password":"enc","keep_alive":30,"term_type":"xterm"}],"keys":[],"macros":[]}`), 0o600))

	err := svc.Import(importPath)
	assert.Error(t, err)
}
