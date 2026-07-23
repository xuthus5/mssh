package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSessionAndKeyDeleteImpact(t *testing.T) {
	db := testutil.NewTestDB(t)
	key, err := store.CreateKey(db, model.SSHKey{Name: "key", Type: model.KeyTypeED25519, PrivateKey: "encrypted"})
	require.NoError(t, err)
	session, err := store.CreateSession(db, model.Session{Name: "server", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthKey, KeyID: &key.ID, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	_, err = store.CreateTunnel(db, model.Tunnel{SessionID: session.ID, Name: "web", Type: model.TunnelLocal, LocalHost: "127.0.0.1", LocalPort: 8080, RemoteHost: "127.0.0.1", RemotePort: 80})
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO command_history (session_id, command) VALUES (?, ?)", session.ID, "ls")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO session_logs (session_id, started_at, data_path) VALUES (?, datetime('now'), ?)", session.ID, "/tmp/test")
	require.NoError(t, err)

	impact, err := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger()).SessionDeleteImpact(session.ID)
	require.NoError(t, err)
	require.Equal(t, &model.SessionDeleteImpact{Tunnels: 1, History: 1, Recordings: 1, Transfers: 0}, impact)

	err = store.CreateTransferJob(db, model.TransferJob{ID: "file-impact", SessionID: session.ID, SessionName: session.Name, Direction: "upload", SourcePath: "/l", TargetPath: "/r", Status: "running", StartedAt: time.Now()})
	require.NoError(t, err)
	impact, err = NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger()).SessionDeleteImpact(session.ID)
	require.NoError(t, err)
	require.Equal(t, &model.SessionDeleteImpact{Tunnels: 1, History: 1, Recordings: 1, Transfers: 1}, impact)
	usage, err := NewKeyService(db, nil, testutil.NewTestLogger()).UsageCount(key.ID)
	require.NoError(t, err)
	require.Equal(t, 1, usage)
}
