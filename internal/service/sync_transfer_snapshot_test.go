package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSyncSnapshotExcludesTransferJobsFromFingerprint(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := newTestSyncService(database, syncTestMasterKey)
	before, err := service.snapshot()
	require.NoError(t, err)
	beforeFingerprint, err := snapshotFingerprint(before)
	require.NoError(t, err)

	require.NoError(t, store.CreateTransferJob(database, transferJob("local-transfer")))
	after, err := service.snapshot()
	require.NoError(t, err)
	afterFingerprint, err := snapshotFingerprint(after)
	require.NoError(t, err)

	assert.Empty(t, before.Tables["transfer_jobs"])
	assert.Empty(t, after.Tables["transfer_jobs"])
	assert.Equal(t, beforeFingerprint, afterFingerprint)
}

func TestSyncRestorePreservesLocalTransferJobsAndIgnoresArtifactRows(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := newTestSyncService(database, syncTestMasterKey)
	require.NoError(t, store.CreateTransferJob(database, transferJob("local-transfer")))
	data, err := service.snapshot()
	require.NoError(t, err)
	data.Tables["transfer_jobs"] = []map[string]any{transferSnapshotRow("remote-transfer")}

	require.NoError(t, service.restore(data))
	jobs, err := store.ListTransferJobs(database)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "local-transfer", jobs[0].ID)
}

func transferJob(id string) model.TransferJob {
	return model.TransferJob{
		ID: id, SessionID: 1, SessionName: "session", Direction: "upload",
		SourcePath: "/source", TargetPath: "/target", Status: "completed", StartedAt: time.Unix(1, 0).UTC(),
	}
}

func transferSnapshotRow(id string) map[string]any {
	return map[string]any{
		"id": id, "session_id": int64(2), "session_name": "remote", "direction": "download",
		"source_path": "/remote", "target_path": "/local", "total_bytes": int64(1),
		"transferred_bytes": int64(1), "speed": int64(0), "eta": int64(0), "status": "completed",
		"error": "", "started_at": time.Unix(2, 0).UTC().Format(time.RFC3339Nano), "completed_at": nil,
	}
}
