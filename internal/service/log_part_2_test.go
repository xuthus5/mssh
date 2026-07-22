package service

import (
	"bytes"
	"database/sql"
	"errors"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestLogService_StopTerminalRecordingCombinesCloseAndDatabaseErrors(t *testing.T) {
	tests := []struct {
		name string
		stop func(*LogService, string) error
	}{
		{name: "required", stop: func(service *LogService, terminalID string) error {
			return service.StopTerminalRecording(terminalID)
		}},
		{name: "if active", stop: func(service *LogService, terminalID string) error {
			return service.StopTerminalRecordingIfActive(terminalID)
		}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			created, err := store.CreateSessionLog(db, model.SessionLog{DataPath: "/tmp/error.log"})
			require.NoError(t, err)
			require.NoError(t, db.Close())
			closeErr := errors.New("close failed")
			recorder := &fakeTerminalRecorder{closeErr: closeErr}
			svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())
			svc.recorders["term-errors"] = &activeRecording{recorder: recorder, logID: created.ID}

			err = test.stop(svc, "term-errors")

			assert.ErrorIs(t, err, closeErr)
			assert.ErrorContains(t, err, "end session log")
			assert.True(t, recorder.closed)
		})
	}
}

func TestLogService_StopFailureStillAllowsRestart(t *testing.T) {
	db := testutil.NewTestDB(t)
	createdLog, err := store.CreateSessionLog(db, model.SessionLog{DataPath: "/tmp/restart.log"})
	require.NoError(t, err)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())
	closeErr := errors.New("close failed")
	svc.recorders["term-restart"] = &activeRecording{
		recorder: &fakeTerminalRecorder{closeErr: closeErr},
		logID:    createdLog.ID,
	}

	err = svc.StopTerminalRecording("term-restart")
	assert.ErrorIs(t, err, closeErr)
	assert.NotContains(t, svc.recorders, "term-restart")
	session := createLogTestSession(t, db, "restart-after-stop-error")
	_, err = svc.StartTerminalRecording("term-restart", session.ID, 80, 24, "xterm")
	require.NoError(t, err)
	t.Cleanup(func() { _ = svc.StopTerminalRecordingIfActive("term-restart") })
}

func TestLogService_HandleOutput(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-handle-out", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	_, err = svc.StartTerminalRecording("term-out", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)

	svc.HandleOutput("term-out", []byte("hello output"))
	svc.HandleOutput("nonexistent", []byte("no-op"))

	err = svc.StopTerminalRecording("term-out")
	require.NoError(t, err)
}

func TestLogService_HandleOutputLogsWriteError(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&output, &slog.HandlerOptions{Level: slog.LevelError}))
	svc := NewLogService(testutil.NewTestDB(t), t.TempDir(), logger)
	writeErr := errors.New("write failed")
	svc.recorders["term-write-error"] = &activeRecording{
		recorder: &fakeTerminalRecorder{writeErr: writeErr},
		logID:    1,
	}

	svc.HandleOutput("term-write-error", []byte("output"))

	logOutput := output.String()
	assert.Contains(t, logOutput, "write terminal recording failed")
	assert.Contains(t, logOutput, "term-write-error")
	assert.Contains(t, logOutput, "write failed")
}

func TestLogService_GetRecordingNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	_, err := svc.GetRecording("/nonexistent/recording.bin")
	assert.Error(t, err)
}

func createLogTestSession(t *testing.T, db *sql.DB, name string) *model.Session {
	t.Helper()
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	created, err := sessionSvc.CreateSession(model.SessionInput{
		Name: name, Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	return created
}

type fakeTerminalRecorder struct {
	writeErr error
	closeErr error
	closed   bool
}

func (recorder *fakeTerminalRecorder) Write(_ []byte, _ model.RecordType) error {
	return recorder.writeErr
}

func (recorder *fakeTerminalRecorder) Close() error {
	recorder.closed = true
	return recorder.closeErr
}
