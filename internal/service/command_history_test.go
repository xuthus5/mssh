package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestCommandHistoryService(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	session, err := store.CreateSession(db, model.Session{Name: "history", Host: "localhost", Port: 22, Username: "root", AuthMethod: model.AuthPassword, TermType: "xterm"})
	require.NoError(t, err)
	service := NewCommandHistoryService(db, testutil.NewTestLogger())
	created, err := service.Add(session.ID, "  pwd  ")
	require.NoError(t, err)
	require.Equal(t, "pwd", created.Command)
	items, err := service.List(session.ID, "pwd")
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.NoError(t, service.Delete(created.ID))
	require.NoError(t, service.Clear(session.ID))
}

func TestCommandHistoryService_SkipsSensitiveAndEmpty(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	session, err := store.CreateSession(db, model.Session{Name: "history-sens", Host: "localhost", Port: 22, Username: "root", AuthMethod: model.AuthPassword, TermType: "xterm"})
	require.NoError(t, err)
	service := NewCommandHistoryService(db, testutil.NewTestLogger())

	cases := []string{
		"",
		"   ",
		"echo --password secret",
		"export OPENAI_API_KEY=sk-test",
		`curl -H "Authorization: Bearer abc" https://example.com`,
		"sshpass -p secret ssh host",
		"mysql -uroot -psecret",
		"AWS_SECRET_ACCESS_KEY=x aws s3 ls",
	}
	for _, command := range cases {
		created, err := service.Add(session.ID, command)
		require.NoError(t, err, "command=%q", command)
		require.Nil(t, created, "command=%q", command)
	}

	// Safe commands still persist.
	created, err := service.Add(session.ID, "ls -la")
	require.NoError(t, err)
	require.NotNil(t, created)
	require.Equal(t, "ls -la", created.Command)
	items, err := service.List(session.ID, "")
	require.NoError(t, err)
	require.Len(t, items, 1)
}

func TestIsSensitiveCommand(t *testing.T) {
	require.True(t, isSensitiveCommand("echo --password secret"))
	require.True(t, isSensitiveCommand("export OPENAI_API_KEY=sk-test"))
	require.True(t, isSensitiveCommand(`curl -H "Authorization: Bearer abc"`))
	require.True(t, isSensitiveCommand("sshpass -p secret ssh host"))
	require.True(t, isSensitiveCommand("mysql -uroot -psecret"))
	require.True(t, isSensitiveCommand("AWS_SECRET_ACCESS_KEY=x aws s3 ls"))
	require.False(t, isSensitiveCommand("ls -la"))
	require.False(t, isSensitiveCommand("git status"))
	require.False(t, isSensitiveCommand("echo hello"))
	require.False(t, isSensitiveCommand(""))
}
