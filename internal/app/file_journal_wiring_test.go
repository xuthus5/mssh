package app

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestInitializeServicesWiresTransferFinalizationJournal(t *testing.T) {
	dataDir := t.TempDir()
	database := testutil.NewTestDB(t)
	require.NoError(t, store.CreateTransferJob(database, model.TransferJob{
		ID: "app-journal", SessionID: 1, SessionName: "server", Direction: "upload",
		SourcePath: "/tmp/source", TargetPath: "/remote/target", Status: "running", StartedAt: time.Now(),
	}))
	seedAppTransferJournal(t, dataDir)

	appInstance, err := initializeServices(serviceInitialization{
		db: database, keychain: &stubKeychain{}, opts: Options{DataDir: dataDir},
		eventBus: event.NewWailsEventBus(slog.Default()), logger: slog.Default(),
	})
	require.NoError(t, err)
	t.Cleanup(appInstance.Shutdown)
	jobs, err := appInstance.File.ListTransfers()

	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "completed", jobs[0].Status)
	journalInfo, err := os.Stat(filepath.Join(dataDir, "transfer-finalizations", "journal.json"))
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), journalInfo.Mode().Perm())
}

func seedAppTransferJournal(t *testing.T, dataDir string) {
	t.Helper()
	journalDir := filepath.Join(dataDir, "transfer-finalizations")
	require.NoError(t, os.MkdirAll(journalDir, 0o700))
	document := map[string]any{
		"version": 1,
		"entries": []map[string]any{{
			"task_id": "app-journal", "status": "completed", "error_message": "",
			"transferred": int64(12), "total": int64(12),
			"completed_at": time.Now().UTC().Format(time.RFC3339Nano),
		}},
	}
	data, err := json.Marshal(document)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(journalDir, "journal.json"), data, 0o600))
}
