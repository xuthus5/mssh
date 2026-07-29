package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type finalizationJournalDocumentForTest struct {
	Entries []finalizationJournalEntryForTest `json:"entries"`
}

type finalizationJournalEntryForTest struct {
	TaskID       string `json:"task_id"`
	Status       string `json:"status"`
	ErrorMessage string `json:"error_message,omitempty"`
	Transferred  int64  `json:"transferred"`
	Total        int64  `json:"total"`
	CompletedAt  string `json:"completed_at"`
}

func TestTransferFinalizationJournalRecoversAcrossRestart(t *testing.T) {
	dataDir := t.TempDir()
	database := testutil.NewTestDB(t)
	createJournalTransfer(t, database, "restart-complete", "running")
	require.NoError(t, createTransferFinalizationTrigger(database))
	first := newJournalFileService(database, dataDir)

	first.finishTransfer(transferFinalization{
		taskID: "restart-complete", status: "completed", transferred: 64, total: 64,
	})

	journalPath := finalizationJournalPathForTest(dataDir)
	assertJournalPermissions(t, journalPath)
	assertTransferStatus(t, database, "restart-complete", "running")
	require.NoError(t, dropTransferFinalizationTrigger(database))
	require.NoError(t, store.MarkInterruptedTransfers(database))

	second := newJournalFileService(database, dataDir)
	jobs, err := second.ListTransfers()

	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "completed", jobs[0].Status)
	assert.Equal(t, int64(64), jobs[0].TransferredBytes)
	assert.Empty(t, second.pendingTransferFinalizations())
	assert.Empty(t, readFinalizationJournal(t, journalPath).Entries)
}

func TestTransferFinalizationJournalConcurrentWritesKeepEveryEntry(t *testing.T) {
	const transferCount = 24
	dataDir := t.TempDir()
	database := testutil.NewTestDB(t)
	for index := range transferCount {
		createJournalTransfer(t, database, fmt.Sprintf("journal-%d", index), "running")
	}
	require.NoError(t, createTransferFinalizationTrigger(database))
	service := newJournalFileService(database, dataDir)

	var workers sync.WaitGroup
	for index := range transferCount {
		taskID := fmt.Sprintf("journal-%d", index)
		workers.Add(1)
		go func() {
			defer workers.Done()
			service.finishTransfer(transferFinalization{taskID: taskID, status: "failed", errorMessage: "network"})
		}()
	}
	workers.Wait()

	document := readFinalizationJournal(t, finalizationJournalPathForTest(dataDir))
	require.Len(t, document.Entries, transferCount)
	assertJournalContainsTasks(t, document.Entries, transferCount)
}

func TestTransferFinalizationJournalPreservesTerminalPriority(t *testing.T) {
	dataDir := t.TempDir()
	database := testutil.NewTestDB(t)
	createJournalTransfer(t, database, "priority", "running")
	require.NoError(t, createTransferFinalizationTrigger(database))
	service := newJournalFileService(database, dataDir)

	service.finishTransfer(transferFinalization{taskID: "priority", status: "failed", errorMessage: "network"})
	service.finishTransfer(transferFinalization{taskID: "priority", status: "completed", transferred: 10, total: 10})
	service.finishTransfer(transferFinalization{taskID: "priority", status: "cancelled"})
	service.finishTransfer(transferFinalization{taskID: "priority", status: "completed", transferred: 20, total: 20})

	document := readFinalizationJournal(t, finalizationJournalPathForTest(dataDir))
	require.Len(t, document.Entries, 1)
	assert.Equal(t, "cancelled", document.Entries[0].Status)
	reloaded := newJournalFileService(database, dataDir)
	pending := reloaded.pendingTransferFinalizations()
	require.Len(t, pending, 1)
	assert.Equal(t, "cancelled", pending[0].status)
}

func TestTransferFinalizationJournalCleanupFailureRemainsRetryable(t *testing.T) {
	dataDir := t.TempDir()
	database := testutil.NewTestDB(t)
	createJournalTransfer(t, database, "cleanup-retry", "running")
	require.NoError(t, createTransferFinalizationTrigger(database))
	service := newJournalFileService(database, dataDir)
	service.finishTransfer(transferFinalization{taskID: "cleanup-retry", status: "completed", transferred: 8, total: 8})
	require.NoError(t, dropTransferFinalizationTrigger(database))

	journalPath := finalizationJournalPathForTest(dataDir)
	require.NoError(t, os.Remove(journalPath))
	require.NoError(t, os.Mkdir(journalPath, 0o700))
	_, err := service.ListTransfers()
	require.NoError(t, err)
	assert.Len(t, service.pendingTransferFinalizations(), 1)

	require.NoError(t, os.Remove(journalPath))
	_, err = service.ListTransfers()
	require.NoError(t, err)
	assert.Empty(t, service.pendingTransferFinalizations())
	assert.Empty(t, readFinalizationJournal(t, journalPath).Entries)
}

func TestTransferFinalizationJournalRejectsSymbolicLink(t *testing.T) {
	dataDir := t.TempDir()
	journal := newTransferFinalizationJournalStore(dataDir)
	require.NoError(t, os.MkdirAll(journal.directory, 0o700))
	target := filepath.Join(t.TempDir(), "journal.json")
	require.NoError(t, os.WriteFile(target, []byte(`{"entries":[]}`), 0o600))
	if err := os.Symlink(target, journal.path); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}

	finalizations, err := journal.load()

	assert.Nil(t, finalizations)
	assert.ErrorContains(t, err, "regular file")
}

func newJournalFileService(database *sql.DB, dataDir string) *FileService {
	return NewFileService(nil, newMockEventBus(), testutil.NewTestLogger(),
		WithTransferDB(database), WithTransferJournalDataDir(dataDir))
}

func createJournalTransfer(t *testing.T, database *sql.DB, taskID, status string) {
	t.Helper()
	require.NoError(t, store.CreateTransferJob(database, model.TransferJob{
		ID: taskID, SessionID: 1, SessionName: "server", Direction: "upload",
		SourcePath: "/tmp/source", TargetPath: "/remote/target", Status: status, StartedAt: time.Now(),
	}))
}

func finalizationJournalPathForTest(dataDir string) string {
	return filepath.Join(dataDir, "transfer-finalizations", "journal.json")
}

func readFinalizationJournal(t *testing.T, path string) finalizationJournalDocumentForTest {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var document finalizationJournalDocumentForTest
	require.NoError(t, json.Unmarshal(data, &document))
	return document
}

func assertJournalPermissions(t *testing.T, journalPath string) {
	t.Helper()
	directoryInfo, err := os.Stat(filepath.Dir(journalPath))
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o700), directoryInfo.Mode().Perm())
	journalInfo, err := os.Stat(journalPath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), journalInfo.Mode().Perm())
}

func assertTransferStatus(t *testing.T, database *sql.DB, taskID, expected string) {
	t.Helper()
	var actual string
	require.NoError(t, database.QueryRow("SELECT status FROM transfer_jobs WHERE id = ?", taskID).Scan(&actual))
	assert.Equal(t, expected, actual)
}

func assertJournalContainsTasks(t *testing.T, entries []finalizationJournalEntryForTest, count int) {
	t.Helper()
	statuses := make(map[string]string, len(entries))
	for _, entry := range entries {
		statuses[entry.TaskID] = entry.Status
	}
	for index := range count {
		assert.Equal(t, "failed", statuses[fmt.Sprintf("journal-%d", index)])
	}
}
