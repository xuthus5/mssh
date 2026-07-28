package service

import (
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestStopTerminalRecordingRetriesSessionLogFinalization(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewLogService(database, t.TempDir(), testutil.NewTestLogger())
	created, err := store.CreateSessionLog(database, model.SessionLog{DataPath: "/tmp/retry-finalization.log"})
	require.NoError(t, err)
	service.recorders["term-retry"] = &activeRecording{recorder: &fakeTerminalRecorder{}, logID: created.ID}
	transientErr := errors.New("database is locked")
	calls := 0
	service.endSessionLog = func(database *sql.DB, logID int64) error {
		calls++
		if calls < 3 {
			return transientErr
		}
		return store.EndSessionLog(database, logID)
	}

	require.NoError(t, service.StopTerminalRecordingIfActive("term-retry"))
	assert.Equal(t, 3, calls)
	stored, err := store.GetSessionLog(database, created.ID)
	require.NoError(t, err)
	assert.NotNil(t, stored.EndedAt)
}

func TestStopTerminalRecordingDoesNotRetryPermanentFinalizationFailure(t *testing.T) {
	service := NewLogService(nil, t.TempDir(), testutil.NewTestLogger())
	service.recorders["term-permanent"] = &activeRecording{recorder: &fakeTerminalRecorder{}, logID: 1}
	permanentErr := errors.New("constraint failed")
	calls := 0
	service.endSessionLog = func(*sql.DB, int64) error {
		calls++
		return permanentErr
	}

	err := service.StopTerminalRecordingIfActive("term-permanent")

	require.ErrorIs(t, err, permanentErr)
	assert.Equal(t, 1, calls)
}

func TestIsRetryableSessionLogFinalizeError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "bad connection", err: fmt.Errorf("finalize: %w", driver.ErrBadConn), want: true},
		{name: "sqlite busy", err: errors.New("database is busy"), want: true},
		{name: "sqlite locked", err: errors.New("SQLITE_LOCKED"), want: true},
		{name: "permanent", err: errors.New("constraint failed"), want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Equal(t, test.want, isRetryableSessionLogFinalizeError(test.err))
		})
	}
}

func TestNewLogServiceRecoversIncompleteSessionLogs(t *testing.T) {
	database := testutil.NewTestDB(t)
	created, err := store.CreateSessionLog(database, model.SessionLog{DataPath: "/tmp/interrupted.log"})
	require.NoError(t, err)

	_ = NewLogService(database, t.TempDir(), testutil.NewTestLogger())

	stored, err := store.GetSessionLog(database, created.ID)
	require.NoError(t, err)
	assert.NotNil(t, stored.EndedAt)
}
