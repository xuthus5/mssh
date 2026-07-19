package service

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSessionService_PreviewCSV(t *testing.T) {
	path := writeExternalSessionCSVFixture(t, []string{"Session Name", "Host", "Login Password", "Identity File"}, [][]string{
		{"production", "10.0.0.1", "secret", "/root/.ssh/id_ed25519"},
		{"staging", "10.0.0.2", "another", "/root/.ssh/id_rsa"},
	})
	service := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	preview, err := service.PreviewCSV(path)
	require.NoError(t, err)
	assert.Equal(t, []string{"Session Name", "Host", "Login Password", "Identity File"}, preview.Headers)
	assert.Equal(t, 2, preview.TotalRows)
	require.Len(t, preview.SampleRows, 2)
	assert.Equal(t, []string{"production", "10.0.0.1", "******", "******"}, preview.SampleRows[0])
	largeRows := make([][]string, 21)
	for index := range largeRows {
		largeRows[index] = []string{"server", "10.0.0.1"}
	}
	largePath := writeExternalSessionCSVFixture(t, []string{"Name", "Host"}, largeRows)
	largePreview, err := service.PreviewCSV(largePath)
	require.NoError(t, err)
	assert.Len(t, largePreview.SampleRows, maxSessionCSVPreviewRows)
	_, err = service.PreviewCSV(filepath.Join(t.TempDir(), "missing.csv"))
	assert.Error(t, err)
}

func TestSessionService_ImportCSVMapsExternalHeadersAndDefaults(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	path := writeExternalSessionCSVFixture(t, []string{"Session", "Hostname", "Port", "User", "Authentication", "Folder", "Tags", "Description"}, [][]string{
		{"production", "10.0.0.1", "", "root", "Password", `Infrastructure\\Production`, "critical,linux", "primary server"},
	})
	options := model.SessionCSVImportOptions{
		ConflictPolicy: model.SessionCSVConflictSkip,
		HeaderMapping: map[string]string{
			"name": "Session", "host": "Hostname", "port": "Port", "username": "User", "auth_method": "Authentication",
			"folder_path": "Folder", "tags": "Tags", "notes": "Description",
		},
		DefaultValues: map[string]string{"port": "2022", "environment": "production", "keep_alive": "45"},
	}

	summary, err := service.ImportCSV(path, options)
	require.NoError(t, err)
	assert.Equal(t, 1, summary.Imported)
	assert.Zero(t, summary.Failed)
	sessions, err := store.ListSessions(db, nil)
	require.NoError(t, err)
	require.Len(t, sessions, 1)
	assert.Equal(t, 2022, sessions[0].Port)
	assert.Equal(t, model.AuthPassword, sessions[0].AuthMethod)
	assert.Equal(t, 45, sessions[0].KeepAlive)
	assert.Equal(t, "xterm-256color", sessions[0].TermType)
	assert.Equal(t, "production", sessions[0].Environment.Name)
	assert.Equal(t, "primary server", sessions[0].Notes)
	assert.ElementsMatch(t, []string{"critical", "linux"}, []string{sessions[0].Tags[0].Name, sessions[0].Tags[1].Name})
	var folderCount int
	err = db.QueryRow(`SELECT COUNT(*) FROM session_folders WHERE name IN ('Infrastructure', 'Production')`).Scan(&folderCount)
	require.NoError(t, err)
	assert.Equal(t, 2, folderCount)
}

func TestSessionCSVMappingValidation(t *testing.T) {
	records := [][]string{{"Name", "Host"}, {"server", "10.0.0.1"}}
	tests := []struct {
		name     string
		mapping  map[string]string
		defaults map[string]string
		message  string
	}{
		{name: "unknown target", mapping: map[string]string{"unknown": "Name"}, message: "unsupported target"},
		{name: "missing source", mapping: map[string]string{"name": "Missing"}, message: "was not found"},
		{name: "duplicate source", mapping: map[string]string{"name": "Name", "host": "Name"}, message: "mapped to both"},
		{name: "unknown default", defaults: map[string]string{"unknown": "value"}, message: "unsupported default"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := mapSessionCSVRecords(records, test.mapping, test.defaults)
			assert.ErrorContains(t, err, test.message)
		})
	}
}

func TestSessionCSVMappingHelpers(t *testing.T) {
	for _, test := range []struct {
		value string
		want  model.AuthMethod
	}{
		{value: "public key", want: model.AuthKey},
		{value: "agent", want: model.AuthAgent},
		{value: "keyboard-interactive", want: model.AuthKeyboardInteractive},
		{value: "custom", want: model.AuthMethod("custom")},
	} {
		assert.Equal(t, test.want, normalizeSessionCSVAuthMethod(test.value))
	}
	assert.Empty(t, csvValueAt([]string{"value"}, -1))
	assert.Empty(t, csvValueAt([]string{"value"}, 1))
	_, err := sessionCSVSourceColumns([]string{"", "host"})
	assert.Error(t, err)
	_, err = sessionCSVSourceColumns([]string{"name", "name"})
	assert.Error(t, err)
}

func TestSessionCSVMappingValidatesHeaderOnlyFiles(t *testing.T) {
	path := writeExternalSessionCSVFixture(t, []string{"Name", "Host"}, nil)
	service := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	_, err := service.ImportCSV(path, model.SessionCSVImportOptions{
		ConflictPolicy: model.SessionCSVConflictSkip,
		HeaderMapping:  map[string]string{"name": "Missing"},
	})
	assert.ErrorContains(t, err, "was not found")
}

func writeExternalSessionCSVFixture(t *testing.T, headers []string, rows [][]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "external.csv")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)
	writer := csv.NewWriter(file)
	require.NoError(t, writer.Write(headers))
	for _, row := range rows {
		require.NoError(t, writer.Write(row))
	}
	writer.Flush()
	require.NoError(t, writer.Error())
	require.NoError(t, file.Close())
	return path
}
