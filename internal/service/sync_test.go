package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestNewSyncService(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger())
	assert.NotNil(t, svc)
}

func TestSyncService_ExportImport(t *testing.T) {
	db := testutil.NewTestDB(t)

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

	macro := model.Macro{Name: "m1", Command: "ls\n"}
	createdMacro, err := macroSvc.Create(model.MacroInputFrom(macro))
	require.NoError(t, err)
	_ = createdMacro

	svc := NewSyncService(db, testutil.NewTestLogger())

	exportPath := filepath.Join(t.TempDir(), "export.json")
	err = svc.Export(exportPath)
	require.NoError(t, err)

	data, err := os.ReadFile(exportPath)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"s1"`)
	assert.Contains(t, string(data), `"k1"`)
	assert.Contains(t, string(data), `"m1"`)

	db2 := testutil.NewTestDB(t)
	svc2 := NewSyncService(db2, testutil.NewTestLogger())

	err = svc2.Import(exportPath)
	require.NoError(t, err)

	s2, err := NewSessionService(db2, newMockEventBus(), 30, "", nil, testutil.NewTestLogger()).ListSessions(nil)
	require.NoError(t, err)
	assert.Len(t, s2, 1)
	assert.Equal(t, "s1", s2[0].Name)

	k2, err := NewKeyService(db2, &noopCrypto{}, testutil.NewTestLogger()).List()
	require.NoError(t, err)
	assert.Len(t, k2, 1)
	assert.Equal(t, "k1", k2[0].Name)

	m2, err := NewMacroService(db2, nil, testutil.NewTestLogger()).List()
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
	require.NoError(t, os.WriteFile(emptyPath, []byte(`{"sessions":[],"keys":[],"macros":[]}`), 0o600))

	err := svc.Import(emptyPath)
	assert.NoError(t, err)
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
	require.NoError(t, os.WriteFile(importPath, []byte(`{"sessions":[{"name":"s1","host":"10.0.0.1","port":22,"username":"root","auth_method":"password","password":"enc","keep_alive":30,"term_type":"xterm"}],"keys":[],"macros":[]}`), 0o600))

	err := svc.Import(importPath)
	assert.Error(t, err)
}
