package service

import (
	"context"
	"errors"
	"fmt"
)

const (
	defaultMaxConcurrentTransfers = 4
	defaultMaxQueuedTransfers     = 64
)

var errTransferQueueFull = errors.New("file transfer queue is full")

type transferRegistration struct {
	taskID string
	spec   transferSpec
	ctx    context.Context
	cancel context.CancelFunc
}

func (f *FileService) prepareQueuedTransfer(registration transferRegistration) (*transferTaskRuntime, error) {
	if err := f.registerTask(registration.taskID, registration.spec.sessionID, registration.cancel); err != nil {
		registration.cancel()
		return nil, err
	}
	runtime := f.taskRuntime(registration.taskID)
	if err := f.createTransfer(registration.taskID, registration.spec.sessionID, registration.spec.direction,
		registration.spec.source, registration.spec.target); err != nil {
		f.releaseRegisteredTask(registration.taskID, registration.cancel)
		return nil, err
	}
	if err := f.acquireTransferSlot(registration.ctx); err != nil {
		f.resolveTransfer(runtime, registration.taskID, func() transferOutcome {
			return cancelledTransferOutcome()
		})
		f.releaseRegisteredTask(registration.taskID, registration.cancel)
		return nil, err
	}
	return runtime, nil
}

func (f *FileService) acquireTransferSlot(ctx context.Context) error {
	if ctx == nil {
		return errors.New("transfer queue context is required")
	}
	select {
	case f.transferSlots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("wait for transfer capacity: %w", ctx.Err())
	}
}

func (f *FileService) releaseTransferSlot() {
	<-f.transferSlots
}
