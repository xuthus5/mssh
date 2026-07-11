//go:build e2e

package e2e_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/app"
	"github.com/xuthus5/mssh/internal/model"
)

func newTestApp(t *testing.T) *app.App {
	t.Helper()
	opts := app.Options{DataDir: t.TempDir(), Logger: app.DefaultTestLogger(t)}
	a, err := app.New(opts)
	require.NoError(t, err)
	t.Cleanup(func() { a.Shutdown() })
	return a
}

// ========== Session CRUD 端到端 ==========

func TestSessionCRUD_E2E(t *testing.T) {
	a := newTestApp(t)

	t.Run("CreateFolder→List→Delete", func(t *testing.T) {
		parentID := int64(0)
		folder, err := a.Session.CreateFolder("生产环境", &parentID)
		require.NoError(t, err)
		assert.Equal(t, "生产环境", folder.Name)
		assert.Equal(t, int64(0), *folder.ParentID)

		folders, err := a.Session.ListFolders()
		require.NoError(t, err)
		assert.Len(t, folders, 1)

		err = a.Session.DeleteFolder(folder.ID)
		require.NoError(t, err)

		folders, err = a.Session.ListFolders()
		require.NoError(t, err)
		assert.Len(t, folders, 0)
	})

	t.Run("CreateSession→List→Update→Delete", func(t *testing.T) {
		s := model.Session{
			Name:       "test-server",
			Host:       "10.0.0.1",
			Port:       22,
			Username:   "root",
			AuthMethod: model.AuthPassword,
			Password:   "encrypted-test",
			KeepAlive:  30,
			TermType:   "xterm-256color",
		}
		created, err := a.Session.CreateSession(s)
		require.NoError(t, err)
		assert.NotZero(t, created.ID)
		assert.Equal(t, "test-server", created.Name)
		assert.Equal(t, "10.0.0.1", created.Host)

		sessions, err := a.Session.ListSessions(nil)
		require.NoError(t, err)
		assert.Len(t, sessions, 1)

		created.Name = "updated-server"
		created.Port = 2222
		err = a.Session.UpdateSession(*created)
		require.NoError(t, err)

		sessions, err = a.Session.ListSessions(nil)
		require.NoError(t, err)
		assert.Equal(t, "updated-server", sessions[0].Name)
		assert.Equal(t, 2222, sessions[0].Port)

		err = a.Session.DeleteSession(created.ID)
		require.NoError(t, err)

		sessions, err = a.Session.ListSessions(nil)
		require.NoError(t, err)
		assert.Len(t, sessions, 0)
	})

	t.Run("Session in Folder", func(t *testing.T) {
		parentID := int64(0)
		folder, err := a.Session.CreateFolder("测试分组", &parentID)
		require.NoError(t, err)

		s := model.Session{
			Name: "folder-session", Host: "1.1.1.1", Port: 22, Username: "u",
			AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
		}
		s.FolderID = &folder.ID
		created, err := a.Session.CreateSession(s)
		require.NoError(t, err)

		// List sessions in folder
		sessions, err := a.Session.ListSessions(&folder.ID)
		require.NoError(t, err)
		assert.Len(t, sessions, 1)
		assert.Equal(t, "folder-session", sessions[0].Name)

		// List all sessions
		all, err := a.Session.ListSessions(nil)
		require.NoError(t, err)
		assert.Len(t, all, 1)

		_ = a.Session.DeleteSession(created.ID)
		_ = a.Session.DeleteFolder(folder.ID)
	})
}

// ========== KeyService 端到端 ==========

func TestKeyService_E2E(t *testing.T) {
	a := newTestApp(t)

	t.Run("Generate RSA→List→Export→Delete", func(t *testing.T) {
		key, err := a.Key.Generate("test-rsa", model.KeyTypeRSA, 2048)
		require.NoError(t, err)
		assert.NotZero(t, key.ID)
		assert.Equal(t, "test-rsa", key.Name)
		assert.Equal(t, model.KeyTypeRSA, key.Type)

		keys, err := a.Key.List()
		require.NoError(t, err)
		assert.Len(t, keys, 1)

		pub, err := a.Key.ExportPublicKey(key.ID)
		require.NoError(t, err)
		assert.Contains(t, pub, "ssh-rsa")

		err = a.Key.Delete(key.ID)
		require.NoError(t, err)

		keys, err = a.Key.List()
		require.NoError(t, err)
		assert.Len(t, keys, 0)
	})

	t.Run("Generate Ed25519", func(t *testing.T) {
		key, err := a.Key.Generate("ed-key", model.KeyTypeED25519, 0)
		require.NoError(t, err)
		assert.Equal(t, model.KeyTypeED25519, key.Type)

		pub, err := a.Key.ExportPublicKey(key.ID)
		require.NoError(t, err)
		assert.Contains(t, pub, "ssh-ed25519")
	})
}

// ========== SettingService 端到端 ==========

func TestSettingService_E2E(t *testing.T) {
	a := newTestApp(t)

	t.Run("GetSet Settings", func(t *testing.T) {
		v, err := a.Setting.GetSetting("nonexistent")
		require.NoError(t, err)
		assert.Equal(t, "", v)

		err = a.Setting.SetSetting("max_pool_size", "32")
		require.NoError(t, err)

		v, err = a.Setting.GetSetting("max_pool_size")
		require.NoError(t, err)
		assert.Equal(t, "32", v)

		err = a.Setting.SetSetting("max_pool_size", "64")
		require.NoError(t, err)

		v, err = a.Setting.GetSetting("max_pool_size")
		require.NoError(t, err)
		assert.Equal(t, "64", v)
	})
}

// ========== MacroService 端到端 ==========

func TestMacroService_E2E(t *testing.T) {
	a := newTestApp(t)

	t.Run("Create→List→Delete", func(t *testing.T) {
		m, err := a.Macro.Create(model.Macro{
			Name:    "hello",
			Command: "echo hello",
		})
		require.NoError(t, err)
		assert.Equal(t, "hello", m.Name)

		list, err := a.Macro.List()
		require.NoError(t, err)
		assert.Len(t, list, 1)

		err = a.Macro.Delete(m.ID)
		require.NoError(t, err)

		list, err = a.Macro.List()
		require.NoError(t, err)
		assert.Len(t, list, 0)
	})
}

// ========== ThemeService 端到端 ==========

func TestThemeService_E2E(t *testing.T) {
	a := newTestApp(t)

	t.Run("Create→List→GetActive→Delete", func(t *testing.T) {
		tm, err := a.Theme.Create(model.Theme{
			Name:   "custom",
			Config: `{"background":"#000"}`,
		})
		require.NoError(t, err)

		list, err := a.Theme.List()
		require.NoError(t, err)
		assert.Len(t, list, 1)

		active, err := a.Theme.GetActive()
		require.NoError(t, err)
		assert.Equal(t, "", active)

		err = a.Theme.Delete(tm.ID)
		require.NoError(t, err)
	})
}

// ========== TunnelService CRUD 端到端 ==========

func TestTunnelService_E2E(t *testing.T) {
	a := newTestApp(t)

	t.Run("Create→List→Delete", func(t *testing.T) {
		s, err := a.Session.CreateSession(model.Session{
			Name: "tunnel-host", Host: "1.1.1.1", Port: 22, Username: "u",
			AuthMethod: model.AuthPassword, KeepAlive: 30,
		})
		require.NoError(t, err)

		tn, err := a.Tunnel.Create(model.Tunnel{
			SessionID:  s.ID,
			Name:       "web",
			Type:       model.TunnelLocal,
			LocalHost:  "127.0.0.1",
			LocalPort:  8080,
			RemoteHost: "remote",
			RemotePort: 80,
		})
		require.NoError(t, err)

		list, err := a.Tunnel.List()
		require.NoError(t, err)
		assert.Len(t, list, 1)

		err = a.Tunnel.Delete(tn.ID)
		require.NoError(t, err)
	})
}

// ========== LogService 端到端 ==========

func TestLogService_E2E(t *testing.T) {
	a := newTestApp(t)

	t.Run("Recording lifecycle", func(t *testing.T) {
		// Start recording (使用 StartRecording)
		logID, err := a.Log.StartRecording(1, 80, 24, "xterm-256color", "")
		require.NoError(t, err)
		assert.NotZero(t, logID)

		// List recordings
		var sid *int64 = nil // list all
		logs, err := a.Log.List(sid)
		require.NoError(t, err)
		assert.Len(t, logs, 1)
		assert.Equal(t, logID, logs[0].ID)

		// Stop recording
		err = a.Log.StopRecording(logID)
		require.NoError(t, err)

		// GetRecording (by dataPath)
		recordings, err := a.Log.List(sid)
		require.NoError(t, err)
		assert.NotEmpty(t, recordings)

		player, err := a.Log.GetRecording(recordings[0].DataPath)
		require.NoError(t, err)
		assert.NotNil(t, player)

		// Delete
		err = a.Log.Delete(logID)
		require.NoError(t, err)
	})
}

// ========== SyncService 端到端 ==========

func TestSyncService_E2E(t *testing.T) {
	a := newTestApp(t)

	t.Run("Export→Import roundtrip", func(t *testing.T) {
		// Create some data
		_, _ = a.Session.CreateFolder("test-folder", nil)
		_, _ = a.Session.CreateSession(model.Session{
			Name: "sync-session", Host: "1.1.1.1", Port: 22, Username: "u",
			AuthMethod: model.AuthPassword, KeepAlive: 30,
		})

		// Export
		exportPath := t.TempDir() + "/export.json"
		err := a.Sync.Export(exportPath)
		require.NoError(t, err)

		// Import
		err = a.Sync.Import(exportPath)
		require.NoError(t, err)
	})
}
