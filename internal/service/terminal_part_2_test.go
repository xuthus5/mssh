package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
)

func TestSessionService_GetClientWrapperAfterDisconnect(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-gcwd", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm",
	}
	created, err := svc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	ctx := context.Background()
	connID, err := svc.connect(ctx, created.ID, true)
	require.NoError(t, err)

	_ = svc.disconnect(connID, true)

	_, err = svc.GetClientWrapper(connID)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}
