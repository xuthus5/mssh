package service

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestFileTransferQueueLimitsActiveSlots(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	service.transferSlots = make(chan struct{}, 1)
	firstContext, cancelFirst := context.WithCancel(context.Background())
	defer cancelFirst()
	require.NoError(t, service.acquireTransferSlot(firstContext))

	secondContext, cancelSecond := context.WithCancel(context.Background())
	defer cancelSecond()
	secondResult := make(chan error, 1)
	go func() { secondResult <- service.acquireTransferSlot(secondContext) }()
	select {
	case err := <-secondResult:
		t.Fatalf("second transfer bypassed the active slot: %v", err)
	case <-time.After(20 * time.Millisecond):
	}

	service.releaseTransferSlot()
	require.NoError(t, <-secondResult)
	service.releaseTransferSlot()
}

func TestFileTransferQueueRejectsOverflow(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	service.maxQueuedTransfers = 1
	_, firstCancel := context.WithCancel(context.Background())
	require.NoError(t, service.registerTask("first", 1, firstCancel))
	_, secondCancel := context.WithCancel(context.Background())
	defer secondCancel()

	err := service.registerTask("second", 1, secondCancel)

	require.ErrorIs(t, err, errTransferQueueFull)
	service.releaseRegisteredTask("first", firstCancel)
}

func TestQueuedFileTransferStopsWhenSessionIsCancelled(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	service.transferSlots = make(chan struct{}, 1)
	service.transferSlots <- struct{}{}
	localPath := filepath.Join(t.TempDir(), "queued.txt")
	require.NoError(t, os.WriteFile(localPath, []byte("queued"), 0o600))
	result := make(chan error, 1)
	go func() {
		_, err := service.Upload(7, localPath, "/queued.txt")
		result <- err
	}()
	require.Eventually(t, func() bool {
		service.mu.Lock()
		defer service.mu.Unlock()
		return len(service.tasks) == 1
	}, time.Second, 10*time.Millisecond)

	service.CancelForSessions([]int64{7})

	require.ErrorIs(t, <-result, context.Canceled)
	service.mu.Lock()
	assert.Empty(t, service.tasks)
	service.mu.Unlock()
	service.releaseTransferSlot()
}
