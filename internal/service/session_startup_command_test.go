package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSessionStartupCommandPersistsAndValidates(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	created, err := service.CreateSession(model.SessionInputFrom(model.Session{
		Name: "startup", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent,
		StartupCommand: "cd /srv/app\n./run.sh", KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	assert.Equal(t, "cd /srv/app\n./run.sh", created.StartupCommand)

	created.StartupCommand = "tmux attach || tmux new"
	require.NoError(t, service.UpdateSession(model.SessionInputFrom(*created)))
	loaded, err := service.GetSession(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "tmux attach || tmux new", loaded.StartupCommand)

	_, err = service.CreateSession(model.SessionInputFrom(model.Session{
		Name: "too-long", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent,
		StartupCommand: strings.Repeat("a", sessionStartupCommandLimit+1), KeepAlive: 30, TermType: "xterm",
	}))
	require.ErrorContains(t, err, "startup_command")
}
