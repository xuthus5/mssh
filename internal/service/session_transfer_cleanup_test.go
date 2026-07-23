package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSessionService_DeleteSessionCancelsTransfers(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	fileSvc := NewFileService(sessionSvc, bus, testutil.NewTestLogger(), WithTransferDB(db))
	sessionSvc.SetTransferCanceller(fileSvc)

	session, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "with-transfer", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	taskID := "file-session-delete"
	fileSvc.mu.Lock()
	fileSvc.tasks[taskID] = cancel
	fileSvc.taskSessions[taskID] = session.ID
	fileSvc.mu.Unlock()
	require.NoError(t, store.CreateTransferJob(db, model.TransferJob{
		ID: taskID, SessionID: session.ID, SessionName: session.Name,
		Direction: "upload", SourcePath: "/local", TargetPath: "/remote",
		Status: "running", StartedAt: time.Now(),
	}))

	require.NoError(t, sessionSvc.DeleteSession(session.ID))

	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("transfer context was not cancelled")
	}

	jobs, err := store.ListTransferJobs(db)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "cancelled", jobs[0].Status)
	assert.Equal(t, "会话已删除", jobs[0].Error)
}

func TestFileService_CancelForSessionsOnlyMatchesOwnedTasks(t *testing.T) {
	bus := newMockEventBus()
	svc := NewFileService(nil, bus, testutil.NewTestLogger())

	keepCtx, keepCancel := context.WithCancel(context.Background())
	dropCtx, dropCancel := context.WithCancel(context.Background())
	svc.mu.Lock()
	svc.tasks["keep"] = keepCancel
	svc.taskSessions["keep"] = 10
	svc.tasks["drop"] = dropCancel
	svc.taskSessions["drop"] = 20
	svc.mu.Unlock()

	svc.CancelForSessions([]int64{20, 0, -1})

	select {
	case <-dropCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("matched transfer was not cancelled")
	}
	select {
	case <-keepCtx.Done():
		t.Fatal("unrelated transfer was cancelled")
	default:
	}
}

func TestSessionService_DeleteSessionsCancelsTransfers(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	fileSvc := NewFileService(sessionSvc, bus, testutil.NewTestLogger(), WithTransferDB(db))
	sessionSvc.SetTransferCanceller(fileSvc)

	first, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "a", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	second, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "b", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)

	ctxA, cancelA := context.WithCancel(context.Background())
	ctxB, cancelB := context.WithCancel(context.Background())
	fileSvc.mu.Lock()
	fileSvc.tasks["a"] = cancelA
	fileSvc.taskSessions["a"] = first.ID
	fileSvc.tasks["b"] = cancelB
	fileSvc.taskSessions["b"] = second.ID
	fileSvc.mu.Unlock()
	require.NoError(t, store.CreateTransferJob(db, model.TransferJob{
		ID: "a", SessionID: first.ID, SessionName: first.Name, Direction: "upload",
		SourcePath: "/a", TargetPath: "/ra", Status: "queued", StartedAt: time.Now(),
	}))
	require.NoError(t, store.CreateTransferJob(db, model.TransferJob{
		ID: "b", SessionID: second.ID, SessionName: second.Name, Direction: "download",
		SourcePath: "/b", TargetPath: "/rb", Status: "running", StartedAt: time.Now(),
	}))

	count, err := sessionSvc.DeleteSessions([]int64{first.ID, second.ID})
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	for _, ctx := range []*struct {
		c    context.Context
		name string
	}{{ctxA, "a"}, {ctxB, "b"}} {
		select {
		case <-ctx.c.Done():
		case <-time.After(time.Second):
			t.Fatalf("transfer %s not cancelled", ctx.name)
		}
	}
	jobs, err := store.ListTransferJobs(db)
	require.NoError(t, err)
	require.Len(t, jobs, 2)
	for _, job := range jobs {
		assert.Equal(t, "cancelled", job.Status)
	}
}
