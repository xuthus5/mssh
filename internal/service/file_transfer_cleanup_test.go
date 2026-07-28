package service

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestRunUploadDoesNotRemoveUnownedRemotePartial(t *testing.T) {
	sftpContext := startSFTPTestServer(t)
	t.Cleanup(sftpContext.cancel)
	service, session := createSFTPFileService(t, sftpContext)
	client, cleanup := openTestSFTPClient(t, service, session.ID)
	t.Cleanup(cleanup)

	taskID := "upload-cleanup"
	temporaryPath := "/remote.mssh-partial-" + taskID
	seedRemoteFile(t, client, temporaryPath)

	service.runUpload(transferExecution{
		ctx: context.Background(), taskID: taskID, client: client,
		source: filepath.Join(t.TempDir(), "missing"), target: "/remote",
	})

	errorMessage := transferErrorForTask(service.eventBus.(*mockEventBus), taskID)
	assert.Contains(t, errorMessage, "open local")
	assert.NotContains(t, errorMessage, "cleanup remote partial")
	_, err := client.Stat(temporaryPath)
	assert.NoError(t, err)
}

func TestRunDownloadDoesNotRemoveUnownedLocalPartial(t *testing.T) {
	sftpContext := startSFTPTestServer(t)
	t.Cleanup(sftpContext.cancel)
	service, session := createSFTPFileService(t, sftpContext)
	client, cleanup := openTestSFTPClient(t, service, session.ID)
	t.Cleanup(cleanup)

	taskID := "download-cleanup"
	targetPath := filepath.Join(t.TempDir(), "download")
	partialPath := downloadPartialPath(targetPath, taskID)
	require.NoError(t, os.WriteFile(partialPath, []byte("keep"), 0o600))
	seedRemoteFile(t, client, "/source")

	service.runDownload(transferExecution{
		ctx: context.Background(), taskID: taskID, client: client,
		source: "/source", target: targetPath,
	})

	errorMessage := transferErrorForTask(service.eventBus.(*mockEventBus), taskID)
	assert.Contains(t, errorMessage, "open local download target")
	assert.NotContains(t, errorMessage, "cleanup local partial")
	data, err := os.ReadFile(partialPath)
	require.NoError(t, err)
	assert.Equal(t, "keep", string(data))
}

func TestRunUploadReportsTransferAndCleanupFailures(t *testing.T) {
	bus := newMockEventBus()
	service := NewFileService(nil, bus, testutil.NewTestLogger(), withFileTransferOperations(fileTransferOperations{
		upload: func(context.Context, *ssh.SFTPClient, string, string, ssh.ProgressFn) (bool, error) {
			return true, errors.New("upload copy failed")
		},
		removeRemote: func(*ssh.SFTPClient, string) error {
			return errors.New("remove denied")
		},
	}))

	service.runUpload(transferExecution{
		ctx: context.Background(), taskID: "upload-failure", source: "/source", target: "/target",
	})

	errorMessage := transferErrorForTask(bus, "upload-failure")
	assert.Contains(t, errorMessage, "upload copy failed")
	assert.Contains(t, errorMessage, "cleanup remote partial")
}

func TestRunDownloadReportsTransferAndCleanupFailures(t *testing.T) {
	bus := newMockEventBus()
	service := NewFileService(nil, bus, testutil.NewTestLogger(), withFileTransferOperations(fileTransferOperations{
		download: func(context.Context, *ssh.SFTPClient, string, string, ssh.ProgressFn) (bool, error) {
			return true, errors.New("download copy failed")
		},
		remoteFileSize: func(*ssh.SFTPClient, string) (int64, error) {
			return 12, nil
		},
		removeLocal: func(string) error {
			return errors.New("remove denied")
		},
	}))

	service.runDownload(transferExecution{
		ctx: context.Background(), taskID: "download-failure", source: "/source", target: "/target",
	})

	errorMessage := transferErrorForTask(bus, "download-failure")
	assert.Contains(t, errorMessage, "download copy failed")
	assert.Contains(t, errorMessage, "cleanup local partial")
}

func TestRunUploadReportsRenameAndCleanupFailures(t *testing.T) {
	bus := newMockEventBus()
	service := NewFileService(nil, bus, testutil.NewTestLogger(), withFileTransferOperations(fileTransferOperations{
		upload: func(context.Context, *ssh.SFTPClient, string, string, ssh.ProgressFn) (bool, error) {
			return true, nil
		},
		renameRemote: func(*ssh.SFTPClient, string, string) error {
			return errors.New("rename denied")
		},
		removeRemote: func(*ssh.SFTPClient, string) error {
			return errors.New("remove denied")
		},
	}))

	service.runUpload(transferExecution{
		ctx: context.Background(), taskID: "upload-rename", source: "/source", target: "/target",
	})

	errorMessage := transferErrorForTask(bus, "upload-rename")
	assert.Contains(t, errorMessage, "rename denied")
	assert.Contains(t, errorMessage, "cleanup remote partial")
}

func TestRunUploadCancellationPersistsCleanupFailure(t *testing.T) {
	database := testutil.NewTestDB(t)
	createCleanupTransfer(t, database, "upload-cancel", "upload")
	var renamed bool
	bus := newMockEventBus()
	service := NewFileService(nil, bus, testutil.NewTestLogger(), WithTransferDB(database),
		withFileTransferOperations(fileTransferOperations{
			upload: func(context.Context, *ssh.SFTPClient, string, string, ssh.ProgressFn) (bool, error) {
				return true, nil
			},
			renameRemote: func(*ssh.SFTPClient, string, string) error {
				renamed = true
				return nil
			},
			removeRemote: func(*ssh.SFTPClient, string) error {
				return errors.New("remote cleanup denied")
			},
		}))
	ctx, cancel := context.WithCancel(context.Background())
	runtime := newTransferTaskRuntime()
	require.True(t, runtime.publish())
	require.True(t, service.cancelRegisteredTransfer(transferCancellation{
		taskID: "upload-cancel", cancel: cancel, runtime: runtime,
	}))
	assert.Equal(t, 1, transferCompleteEventCount(bus, "upload-cancel"))

	service.runUpload(transferExecution{
		ctx: ctx, taskID: "upload-cancel", source: "/source", target: "/target", runtime: runtime,
	})

	job := cleanupTransfer(t, database, "upload-cancel")
	assert.Equal(t, "cancelled", job.Status)
	assert.Contains(t, job.Error, "cleanup remote partial")
	assert.False(t, renamed)
	assert.Equal(t, 1, transferCompleteEventCount(bus, "upload-cancel"))
}

func TestRunDownloadReportsReplaceAndCleanupFailures(t *testing.T) {
	bus := newMockEventBus()
	service := NewFileService(nil, bus, testutil.NewTestLogger(), withFileTransferOperations(fileTransferOperations{
		download: func(context.Context, *ssh.SFTPClient, string, string, ssh.ProgressFn) (bool, error) {
			return true, nil
		},
		remoteFileSize: func(*ssh.SFTPClient, string) (int64, error) {
			return 12, nil
		},
		replaceLocal: func(string, string) error {
			return errors.New("replace denied")
		},
		removeLocal: func(string) error {
			return errors.New("local cleanup denied")
		},
	}))

	service.runDownload(transferExecution{
		ctx: context.Background(), taskID: "download-replace", source: "/source", target: "/target",
	})

	errorMessage := transferErrorForTask(bus, "download-replace")
	assert.Contains(t, errorMessage, "replace denied")
	assert.Contains(t, errorMessage, "cleanup local partial")
}

func TestRunDownloadCancellationPersistsCleanupFailure(t *testing.T) {
	database := testutil.NewTestDB(t)
	createCleanupTransfer(t, database, "download-cancel", "download")
	var replaced bool
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(database),
		withFileTransferOperations(fileTransferOperations{
			download: func(context.Context, *ssh.SFTPClient, string, string, ssh.ProgressFn) (bool, error) {
				return true, nil
			},
			remoteFileSize: func(*ssh.SFTPClient, string) (int64, error) {
				return 12, nil
			},
			replaceLocal: func(string, string) error {
				replaced = true
				return nil
			},
			removeLocal: func(string) error {
				return errors.New("local cleanup denied")
			},
		}))
	ctx, cancel := context.WithCancel(context.Background())
	runtime := newTransferTaskRuntime()
	require.True(t, service.cancelRegisteredTransfer(transferCancellation{
		taskID: "download-cancel", cancel: cancel, runtime: runtime,
	}))

	service.runDownload(transferExecution{
		ctx: ctx, taskID: "download-cancel", source: "/source", target: "/target", runtime: runtime,
	})

	job := cleanupTransfer(t, database, "download-cancel")
	assert.Equal(t, "cancelled", job.Status)
	assert.Contains(t, job.Error, "cleanup local partial")
	assert.False(t, replaced)
}

func seedRemoteFile(t *testing.T, client *ssh.SFTPClient, path string) {
	t.Helper()
	file, err := client.Create(path)
	require.NoError(t, err)
	_, err = file.Write([]byte("keep"))
	require.NoError(t, err)
	require.NoError(t, file.Close())
}

func transferErrorForTask(bus *mockEventBus, taskID string) string {
	for _, captured := range bus.Events() {
		if captured.Name != event.TransferError {
			continue
		}
		payload, ok := captured.Payload.(event.TransferErrorPayload)
		if ok && payload.TaskID == taskID {
			return payload.Error
		}
	}
	return ""
}

func transferCompleteEventCount(bus *mockEventBus, taskID string) int {
	count := 0
	for _, captured := range bus.Events() {
		payload, ok := captured.Payload.(event.TransferProgressPayload)
		if captured.Name == event.TransferComplete && ok && payload.TaskID == taskID {
			count++
		}
	}
	return count
}

func createCleanupTransfer(t *testing.T, database *sql.DB, taskID, direction string) {
	t.Helper()
	require.NoError(t, store.CreateTransferJob(database, model.TransferJob{
		ID: taskID, SessionID: 1, SessionName: "server", Direction: direction,
		SourcePath: "/source", TargetPath: "/target", Status: "running", StartedAt: time.Now(),
	}))
}

func cleanupTransfer(t *testing.T, database *sql.DB, taskID string) model.TransferJob {
	t.Helper()
	jobs, err := store.ListTransferJobs(database)
	require.NoError(t, err)
	for _, job := range jobs {
		if job.ID == taskID {
			return job
		}
	}
	t.Fatalf("transfer %s not found", taskID)
	return model.TransferJob{}
}
