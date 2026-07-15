//go:build e2e

package e2e_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

// ========== TunnelService CRUD 端到端 ==========

func TestTunnelService_E2E(t *testing.T) {
	a := newTestApp(t)

	t.Run("Create→List→Delete", func(t *testing.T) {
		s, err := a.Session.CreateSession(model.SessionInput{
			Name: "tunnel-host", Host: "1.1.1.1", Port: 22, Username: "u",
			AuthMethod: model.AuthPassword, KeepAlive: 30,
		})
		require.NoError(t, err)

		tn, err := a.Tunnel.Create(model.TunnelInput{
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
		session, err := a.Session.CreateSession(model.SessionInput{
			Name: "recording", Host: "127.0.0.1", Port: 22, Username: "root",
			AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
		})
		require.NoError(t, err)
		require.NotNil(t, session)
		const terminalID = "term-e2e-recording"
		logID, err := a.Log.StartTerminalRecording(terminalID, session.ID, 80, 24, "xterm-256color")
		require.NoError(t, err)
		t.Cleanup(func() { _ = a.Log.StopTerminalRecordingIfActive(terminalID) })
		assert.NotZero(t, logID)

		// List recordings
		var sid *int64 = nil // list all
		logs, err := a.Log.List(sid)
		require.NoError(t, err)
		assert.Len(t, logs, 1)
		assert.Equal(t, logID, logs[0].ID)

		err = a.Log.StopTerminalRecording(terminalID)
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
		_, err := a.Session.CreateFolder("test-folder", nil)
		require.NoError(t, err)
		_, err = a.Session.CreateSession(model.SessionInput{
			Name: "sync-session", Host: "1.1.1.1", Port: 22, Username: "u",
			AuthMethod: model.AuthPassword, KeepAlive: 30,
		})
		require.NoError(t, err)

		// Export
		exportPath := t.TempDir() + "/export.json"
		err = a.Sync.Export(exportPath)
		require.NoError(t, err)

		// Import
		err = a.Sync.Import(exportPath)
		require.NoError(t, err)
	})
}

func themeProfileIDs(profiles []model.ThemeProfile) []int64 {
	ids := make([]int64, 0, len(profiles))
	for _, profile := range profiles {
		ids = append(ids, profile.ID)
	}
	return ids
}
