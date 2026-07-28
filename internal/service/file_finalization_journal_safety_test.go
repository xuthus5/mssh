package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestTransferFinalizationJournalInvalidFilesDegradeSafely(t *testing.T) {
	completedAt := time.Now().UTC().Format(time.RFC3339Nano)
	tests := []struct {
		name    string
		content []byte
	}{
		{name: "malformed", content: []byte(`{"version":`)},
		{name: "unknown version", content: []byte(`{"version":2,"entries":[]}`)},
		{name: "unknown field", content: []byte(`{"version":1,"entries":[],"extra":true}`)},
		{name: "invalid status", content: []byte(fmt.Sprintf(
			`{"version":1,"entries":[{"task_id":"bad","status":"running","transferred":0,"total":0,"completed_at":%q}]}`,
			completedAt,
		))},
		{name: "oversized", content: bytes.Repeat([]byte("x"), transferFinalizationJournalMaxBytes+1)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertInvalidJournalDegradesSafely(t, test.content)
		})
	}
}

func assertInvalidJournalDegradesSafely(t *testing.T, original []byte) {
	t.Helper()
	dataDir := t.TempDir()
	journalPath := finalizationJournalPathForTest(dataDir)
	require.NoError(t, os.MkdirAll(filepath.Dir(journalPath), 0o700))
	require.NoError(t, os.WriteFile(journalPath, original, 0o600))
	database := testutil.NewTestDB(t)
	createJournalTransfer(t, database, "safe-degrade", "running")
	require.NoError(t, createTransferFinalizationTrigger(database))
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelError}))

	service := NewFileService(nil, newMockEventBus(), logger,
		WithTransferDB(database), WithTransferJournalDataDir(dataDir))
	service.finishTransfer(transferFinalization{
		taskID: "safe-degrade", status: "completed", transferred: 1, total: 1,
	})

	actual, err := os.ReadFile(journalPath)
	require.NoError(t, err)
	assert.Equal(t, original, actual)
	assert.Len(t, service.pendingTransferFinalizations(), 1)
	assert.Contains(t, logs.String(), "load transfer finalization journal failed")
}

func TestTransferFinalizationJournalDoesNotRegressTerminalDatabaseState(t *testing.T) {
	dataDir := t.TempDir()
	database := testutil.NewTestDB(t)
	createJournalTransfer(t, database, "no-regression", "completed")
	seedFinalizationJournal(t, dataDir, finalizationJournalEntryForTest{
		TaskID: "no-regression", Status: "failed", ErrorMessage: "stale failure",
		CompletedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})

	service := newJournalFileService(database, dataDir)
	jobs, err := service.ListTransfers()

	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "completed", jobs[0].Status)
	assert.Empty(t, service.pendingTransferFinalizations())
}

func TestPendingCancelledOverlaysCompletedDatabaseState(t *testing.T) {
	dataDir := t.TempDir()
	database := testutil.NewTestDB(t)
	createJournalTransfer(t, database, "cancel-wins", "completed")
	require.NoError(t, createTransferFinalizationTrigger(database))
	service := newJournalFileService(database, dataDir)
	service.finishTransfer(transferFinalization{taskID: "cancel-wins", status: "cancelled"})

	jobs, err := service.ListTransfers()

	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "cancelled", jobs[0].Status)
	assertTransferStatus(t, database, "cancel-wins", "completed")
	require.NoError(t, dropTransferFinalizationTrigger(database))
}

func TestTransferFinalizationJournalLoadSecuresFilePermissions(t *testing.T) {
	dataDir := t.TempDir()
	seedFinalizationJournal(t, dataDir, finalizationJournalEntryForTest{
		TaskID: "secure-load", Status: "failed", ErrorMessage: "network",
		CompletedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	journalPath := finalizationJournalPathForTest(dataDir)
	require.NoError(t, os.Chmod(journalPath, 0o644))

	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger(), WithTransferJournalDataDir(dataDir))

	assert.Len(t, service.pendingTransferFinalizations(), 1)
	info, err := os.Stat(journalPath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
}

func TestTransferFinalizationJournalSanitizesLongErrorsAcrossRestart(t *testing.T) {
	dataDir := t.TempDir()
	database := testutil.NewTestDB(t)
	createJournalTransfer(t, database, "long-error", "running")
	require.NoError(t, createTransferFinalizationTrigger(database))
	service := newJournalFileService(database, dataDir)
	rawError := unsafeTransferErrorForTest()

	service.finishTransfer(transferFinalization{taskID: "long-error", status: "failed", errorMessage: rawError})

	document := readFinalizationJournal(t, finalizationJournalPathForTest(dataDir))
	require.Len(t, document.Entries, 1)
	sanitized := document.Entries[0].ErrorMessage
	assert.LessOrEqual(t, len(sanitized), transferFinalizationJournalMaxErrorText)
	assert.True(t, utf8.ValidString(sanitized))
	assert.NotContains(t, sanitized, "\x00")
	assert.Contains(t, sanitized, "\uFFFD")
	require.NoError(t, dropTransferFinalizationTrigger(database))
	reloaded := newJournalFileService(database, dataDir)
	jobs, err := reloaded.ListTransfers()
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "failed", jobs[0].Status)
	assert.Equal(t, sanitized, jobs[0].Error)
}

func TestTransferFinalizationSanitizesErrorBeforeDatabasePersist(t *testing.T) {
	database := testutil.NewTestDB(t)
	createJournalTransfer(t, database, "direct-error", "running")
	service := newJournalFileService(database, t.TempDir())
	rawError := unsafeTransferErrorForTest()

	service.finishTransfer(transferFinalization{
		taskID: "direct-error", status: "failed", errorMessage: rawError,
	})

	jobs, err := service.ListTransfers()
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "failed", jobs[0].Status)
	assert.LessOrEqual(t, len(jobs[0].Error), transferFinalizationJournalMaxErrorText)
	assert.True(t, utf8.ValidString(jobs[0].Error))
	assert.NotContains(t, jobs[0].Error, "\x00")
	assert.Contains(t, jobs[0].Error, "\uFFFD")
	assert.NotEqual(t, rawError, jobs[0].Error)
	assert.Empty(t, service.pendingTransferFinalizations())
}

func seedFinalizationJournal(t *testing.T, dataDir string, entries ...finalizationJournalEntryForTest) {
	t.Helper()
	journalPath := finalizationJournalPathForTest(dataDir)
	require.NoError(t, os.MkdirAll(filepath.Dir(journalPath), 0o700))
	document := finalizationJournalDocumentForTest{Version: 1, Entries: entries}
	data, err := jsonMarshalForTest(document)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(journalPath, data, 0o600))
}

func jsonMarshalForTest(value any) ([]byte, error) {
	return json.Marshal(value)
}

func unsafeTransferErrorForTest() string {
	return "prefix\x00" + string([]byte{0xff}) + strings.Repeat("错误", transferFinalizationJournalMaxErrorText)
}
