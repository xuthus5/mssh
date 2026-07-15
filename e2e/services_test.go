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
	t.Run("CreateFolder→List→Delete", func(t *testing.T) { testSessionFolderCRUD(t, a) })
	t.Run("CreateSession→List→Update→Delete", func(t *testing.T) { testSessionCRUD(t, a) })
	t.Run("Session in Folder", func(t *testing.T) { testSessionInFolder(t, a) })
}

func testSessionFolderCRUD(t *testing.T, a *app.App) {
	folder, err := a.Session.CreateFolder("生产环境", nil)
	require.NoError(t, err)
	assert.Equal(t, "生产环境", folder.Name)
	assert.Nil(t, folder.ParentID)
	folders, err := a.Session.ListFolders()
	require.NoError(t, err)
	assert.Len(t, folders, 2)
	err = a.Session.DeleteFolder(folder.ID)
	require.NoError(t, err)
	folders, err = a.Session.ListFolders()
	require.NoError(t, err)
	assert.Len(t, folders, 1)
}

func testSessionCRUD(t *testing.T, a *app.App) {
	s := model.Session{Name: "test-server", Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, Password: "encrypted-test", KeepAlive: 30, TermType: "xterm-256color"}
	created, err := a.Session.CreateSession(model.SessionInputFrom(s))
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	assert.Equal(t, "test-server", created.Name)
	assert.Equal(t, "10.0.0.1", created.Host)
	sessions, err := a.Session.ListSessions(nil)
	require.NoError(t, err)
	assert.Len(t, sessions, 1)
	created.Name = "updated-server"
	created.Port = 2222
	err = a.Session.UpdateSession(model.SessionInputFrom(*created))
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
}

func testSessionInFolder(t *testing.T, a *app.App) {
	folder, err := a.Session.CreateFolder("测试分组", nil)
	require.NoError(t, err)
	s := model.Session{Name: "folder-session", Host: "1.1.1.1", Port: 22, Username: "u", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"}
	s.FolderID = &folder.ID
	created, err := a.Session.CreateSession(model.SessionInputFrom(s))
	require.NoError(t, err)
	sessions, err := a.Session.ListSessions(&folder.ID)
	require.NoError(t, err)
	assert.Len(t, sessions, 1)
	assert.Equal(t, "folder-session", sessions[0].Name)
	all, err := a.Session.ListSessions(nil)
	require.NoError(t, err)
	assert.Len(t, all, 1)
	require.NoError(t, a.Session.DeleteSession(created.ID))
	require.NoError(t, a.Session.DeleteFolder(folder.ID))
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

	t.Run("typed settings lifecycle", func(t *testing.T) {
		setting, err := a.Setting.Get("terminal.max_pool_size")
		require.NoError(t, err)
		assert.Nil(t, setting)

		entry := model.Setting{Key: "terminal.max_pool_size", Namespace: "terminal", Value: `32`, ValueType: "number", Version: 1}
		err = a.Setting.Set(model.SettingInputFrom(entry))
		require.NoError(t, err)

		setting, err = a.Setting.Get(entry.Key)
		require.NoError(t, err)
		require.NotNil(t, setting)
		assert.Equal(t, `32`, setting.Value)

		entry.Value = `64`
		err = a.Setting.Set(model.SettingInputFrom(entry))
		require.NoError(t, err)

		setting, err = a.Setting.Get(entry.Key)
		require.NoError(t, err)
		require.NotNil(t, setting)
		assert.Equal(t, `64`, setting.Value)
	})
}

// ========== MacroService 端到端 ==========

func TestMacroService_E2E(t *testing.T) {
	a := newTestApp(t)

	t.Run("Create→List→Delete", func(t *testing.T) {
		m, err := a.Macro.Create(model.MacroInput{
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

	t.Run("CreateProfile→ListProfiles→DeleteProfile", func(t *testing.T) {
		definitions, err := a.Theme.ListDefinitions("")
		require.NoError(t, err)
		require.NotEmpty(t, definitions)
		profile, err := a.Theme.CreateCustomProfile(model.ThemeProfileInput{
			Name: "custom", ThemeID: definitions[0].ID, FollowGlobalStyle: true,
			FontFamily: model.DefaultTerminalFontFamily, FontSize: model.DefaultTerminalFontSize,
			CursorStyle: model.CursorStyleBlock, ColorOverrides: `{}`,
		})
		require.NoError(t, err)

		profiles, err := a.Theme.ListProfiles("")
		require.NoError(t, err)
		assert.Contains(t, themeProfileIDs(profiles), profile.ID)

		err = a.Theme.DeleteProfile(profile.ID)
		require.NoError(t, err)
		_, err = a.Theme.GetProfile(profile.ID)
		assert.Error(t, err)
	})
}
