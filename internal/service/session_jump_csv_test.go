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

func TestSessionCSVOverwriteRetainsSSHJumpHost(t *testing.T) {
	service := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())
	created, err := service.CreateSession(jumpHostSessionInput())
	require.NoError(t, err)
	path := writeSessionCSVFixture(t, []map[string]string{csvFixtureRow(map[string]string{
		"name": created.Name, "host": created.Host, "port": "22", "username": created.Username,
		"notes": "updated by csv", "password": "",
	})})
	summary, err := service.ImportCSV(path, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictOverwrite})
	require.NoError(t, err)
	assert.Equal(t, 1, summary.Updated)
	loaded, err := service.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "updated by csv", loaded.Notes)
	require.NotNil(t, loaded.JumpHost)
	assert.Equal(t, "bastion.example", loaded.JumpHost.Host)
	assert.Equal(t, "jump-secret", loaded.JumpHost.Password)
}

func TestSessionCSVDoesNotExposeSSHJumpHostPassword(t *testing.T) {
	service := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())
	_, err := service.CreateSession(jumpHostSessionInput())
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "sessions.csv")
	_, err = service.ExportCSV(path, model.SessionCSVExportOptions{})
	require.NoError(t, err)
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.NotContains(t, string(content), "jump-secret")
	assert.NotContains(t, string(content), "target-secret")
	assert.NotContains(t, string(content), "enc:")
}
