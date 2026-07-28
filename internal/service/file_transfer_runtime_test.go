package service

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestTransferCancellationWinsBeforeCommit(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	runtime := newTransferTaskRuntime()
	ctx, cancel := context.WithCancel(context.Background())
	cancelStarted := make(chan struct{})
	releaseCancel := make(chan struct{})
	cancelled := make(chan bool, 1)
	go func() {
		cancelled <- service.cancelRegisteredTransfer(transferCancellation{
			taskID:  "cancel-before-commit",
			cancel:  cancel,
			runtime: runtime,
			closer: func() error {
				close(cancelStarted)
				<-releaseCancel
				return nil
			},
		})
	}()
	<-cancelStarted

	var committed atomic.Bool
	commitFinished := make(chan bool, 1)
	go func() {
		commitFinished <- service.resolveTransfer(runtime, "cancel-before-commit", func() transferOutcome {
			committed.Store(true)
			return completedTransferOutcome(1, 1)
		})
	}()
	select {
	case <-commitFinished:
		t.Fatal("commit bypassed in-flight cancellation")
	case <-time.After(20 * time.Millisecond):
	}

	close(releaseCancel)
	assert.True(t, <-cancelled)
	assert.False(t, <-commitFinished)
	assert.False(t, committed.Load())
	assert.ErrorIs(t, ctx.Err(), context.Canceled)
}

func TestCancelTransferWaitsForWorkerCleanup(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	require.NoError(t, service.registerTask("wait-for-cleanup", 1, cancel))

	result := make(chan error, 1)
	go func() { result <- service.CancelTransfer("wait-for-cleanup") }()
	require.Eventually(t, func() bool { return ctx.Err() != nil }, time.Second, 10*time.Millisecond)
	select {
	case err := <-result:
		t.Fatalf("cancel returned before worker cleanup: %v", err)
	case <-time.After(20 * time.Millisecond):
	}

	runtime := service.taskRuntime("wait-for-cleanup")
	service.removeTask("wait-for-cleanup")
	service.workers.Done()
	runtime.signalDone()
	require.NoError(t, <-result)
}
