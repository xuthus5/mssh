package store

import (
	"mssh/internal/model"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateAndListTunnels(t *testing.T) {
	db := setupTestDB(t)
	s := model.Session{
		Name: "test-session", Host: "10.0.0.1", Port: 22,
		Username: "root", AuthMethod: model.AuthPassword, Password: "enc",
		KeepAlive: 30, TermType: "xterm-256color",
	}
	session, err := CreateSession(db, s)
	require.NoError(t, err)

	tun := model.Tunnel{
		SessionID: session.ID, Name: "web-forward",
		Type: model.TunnelLocal, LocalHost: "127.0.0.1",
		LocalPort: 8080, RemoteHost: "10.0.0.2", RemotePort: 80,
	}
	created, err := CreateTunnel(db, tun)
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	assert.Equal(t, "web-forward", created.Name)

	tunnels, err := ListTunnels(db)
	require.NoError(t, err)
	assert.Len(t, tunnels, 1)
	assert.Equal(t, "web-forward", tunnels[0].Name)
}

func TestUpdateTunnel(t *testing.T) {
	db := setupTestDB(t)
	s := model.Session{
		Name: "test-session", Host: "10.0.0.1", Port: 22,
		Username: "root", AuthMethod: model.AuthPassword, Password: "enc",
		KeepAlive: 30, TermType: "xterm-256color",
	}
	session, err := CreateSession(db, s)
	require.NoError(t, err)

	tun := model.Tunnel{
		SessionID: session.ID, Name: "old-forward",
		Type: model.TunnelLocal, LocalHost: "127.0.0.1",
		LocalPort: 3000, RemoteHost: "10.0.0.3", RemotePort: 3000,
	}
	created, err := CreateTunnel(db, tun)
	require.NoError(t, err)

	created.Name = "new-forward"
	created.RemotePort = 4000
	err = UpdateTunnel(db, *created)
	require.NoError(t, err)

	tunnels, err := ListTunnels(db)
	require.NoError(t, err)
	assert.Len(t, tunnels, 1)
	assert.Equal(t, "new-forward", tunnels[0].Name)
	assert.Equal(t, 4000, tunnels[0].RemotePort)
}

func TestDeleteTunnel(t *testing.T) {
	db := setupTestDB(t)
	s := model.Session{
		Name: "test-session", Host: "10.0.0.1", Port: 22,
		Username: "root", AuthMethod: model.AuthPassword, Password: "enc",
		KeepAlive: 30, TermType: "xterm-256color",
	}
	session, err := CreateSession(db, s)
	require.NoError(t, err)

	tun := model.Tunnel{
		SessionID: session.ID, Name: "temp-forward",
		Type: model.TunnelRemote, LocalPort: 5000, RemoteHost: "10.0.0.5", RemotePort: 5000,
	}
	created, err := CreateTunnel(db, tun)
	require.NoError(t, err)

	err = DeleteTunnel(db, created.ID)
	require.NoError(t, err)

	tunnels, err := ListTunnels(db)
	require.NoError(t, err)
	assert.Len(t, tunnels, 0)
}

func TestListTunnelsEmpty(t *testing.T) {
	db := setupTestDB(t)
	tunnels, err := ListTunnels(db)
	require.NoError(t, err)
	assert.Len(t, tunnels, 0)
}
