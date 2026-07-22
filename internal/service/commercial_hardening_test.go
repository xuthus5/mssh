package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
)

func TestSessionConnectRequiresDataDirForHostKeys(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	created, err := svc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "no-dir", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "secret", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	_, err = svc.connect(context.Background(), created.ID, false)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "data directory")
}

func TestSessionCloseAllRunsCleanup(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	cleaned := false
	svc.mu.Lock()
	svc.conns["term-cleanup"] = &managedConn{
		wrapper: nil,
		cleanup: func() { cleaned = true },
	}
	svc.mu.Unlock()
	require.NoError(t, svc.CloseAll())
	assert.True(t, cleaned)
	assert.Equal(t, 0, svc.ConnectionCount())
}

func TestSealAndOpenSessionPasswordRoundTrip(t *testing.T) {
	runtime := NewCryptoRuntime()
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i + 1)
	}
	runtime.SetDEK(dek)
	sealed, err := sealSessionPassword(runtime, "s3cret-value")
	require.NoError(t, err)
	assert.NotEqual(t, "s3cret-value", sealed)
	assert.True(t, len(sealed) > 0)
	opened, err := openSessionPassword(runtime, sealed)
	require.NoError(t, err)
	assert.Equal(t, "s3cret-value", opened)

	_, err = openSessionPassword(runtime, "plain-not-allowed")
	assert.Error(t, err)
	empty, err := sealSessionPassword(runtime, "")
	require.NoError(t, err)
	assert.Equal(t, "", empty)
}

func TestSSHConnectRequiresKnownHostsPath(t *testing.T) {
	_, err := ssh.Connect(context.Background(), model.Session{Host: "127.0.0.1", Port: 22, Username: "x"}, nil, "", testutil.NewTestLogger())
	require.Error(t, err)
}

func TestSessionCRUDPasswordSealed(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i + 3)
	}
	runtime.SetDEK(dek)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), runtime, testutil.NewTestLogger())

	created, err := svc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "secure", Host: "10.0.0.8", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "plain-pass", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	assert.Empty(t, created.Password)

	listed, err := svc.ListSessions(nil)
	require.NoError(t, err)
	require.NotEmpty(t, listed)
	assert.Empty(t, listed[0].Password)

	// update password
	err = svc.UpdateSession(model.SessionInputFrom(model.Session{
		ID: created.ID, Name: "secure", Host: "10.0.0.8", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "new-pass-value", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	got, err := svc.GetSession(created.ID)
	require.NoError(t, err)
	assert.Empty(t, got.Password)

	connectable, err := svc.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "new-pass-value", connectable.Password)
}
