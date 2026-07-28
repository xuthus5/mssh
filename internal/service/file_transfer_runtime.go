package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

type transferTaskRuntime struct {
	mu         sync.Mutex
	doneOnce   sync.Once
	terminal   bool
	cancelling bool
	cancelSent bool
	published  bool
	cancelErr  error
	done       chan struct{}
}

func newTransferTaskRuntime() *transferTaskRuntime {
	return &transferTaskRuntime{done: make(chan struct{})}
}

func (runtime *transferTaskRuntime) resolve(factory, cancellationFactory func() transferOutcome) (
	transferOutcome, bool, bool, bool,
) {
	if runtime == nil {
		return factory(), true, true, true
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if runtime.terminal {
		return transferOutcome{}, false, false, false
	}
	outcome, primary := runtime.resolutionOutcome(factory, cancellationFactory)
	runtime.terminal = true
	return outcome, runtime.published && !runtime.cancelSent, true, primary
}

func (runtime *transferTaskRuntime) resolutionOutcome(
	factory, cancellationFactory func() transferOutcome,
) (transferOutcome, bool) {
	if !runtime.cancelling {
		return factory(), true
	}
	outcome := cancelledTransferOutcome()
	if cancellationFactory != nil {
		outcome = cancellationFactory()
	}
	outcome.status = "cancelled"
	outcome.err = errors.Join(outcome.err, runtime.cancelErr)
	return outcome, false
}

func (runtime *transferTaskRuntime) requestCancellation(cancel func() error) (bool, bool) {
	if runtime == nil {
		return false, false
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if runtime.terminal || runtime.cancelling {
		return false, false
	}
	runtime.cancelling = true
	runtime.cancelErr = cancel()
	runtime.cancelSent = runtime.published
	return true, runtime.cancelSent
}

func (runtime *transferTaskRuntime) signalDone() {
	if runtime != nil {
		runtime.doneOnce.Do(func() { close(runtime.done) })
	}
}

func (runtime *transferTaskRuntime) publish() bool {
	if runtime == nil {
		return true
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if runtime.terminal || runtime.cancelling {
		return false
	}
	runtime.published = true
	return true
}

type transferOutcome struct {
	status      string
	err         error
	transferred int64
	total       int64
}

func cancelledTransferOutcome(errs ...error) transferOutcome {
	return transferOutcome{status: "cancelled", err: errors.Join(errs...)}
}

func failedTransferOutcome(err error) transferOutcome {
	return transferOutcome{status: "failed", err: err}
}

func completedTransferOutcome(transferred, total int64) transferOutcome {
	return transferOutcome{status: "completed", transferred: transferred, total: total}
}

func transferOutcomeForError(ctx context.Context, err error) transferOutcome {
	if ctx != nil && ctx.Err() != nil {
		return cancelledTransferOutcome()
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return cancelledTransferOutcome()
	}
	return failedTransferOutcome(err)
}

func (f *FileService) resolveTransfer(runtime *transferTaskRuntime, taskID string,
	factory func() transferOutcome,
) bool {
	return f.resolveTransferWithCancellation(runtime, taskID, factory, nil)
}

func (f *FileService) resolveTransferWithCancellation(runtime *transferTaskRuntime, taskID string,
	factory, cancellationFactory func() transferOutcome,
) bool {
	outcome, published, resolved, primary := runtime.resolve(factory, cancellationFactory)
	if !resolved {
		return false
	}
	if published {
		f.emitTransferOutcome(taskID, outcome)
	} else {
		f.persistTransferOutcome(taskID, outcome)
	}
	return primary
}

func (f *FileService) persistTransferOutcome(taskID string, outcome transferOutcome) {
	errorMessage := ""
	if outcome.err != nil {
		errorMessage = outcome.err.Error()
	}
	f.finishTransfer(transferFinalization{
		taskID: taskID, status: outcome.status, errorMessage: errorMessage,
		transferred: outcome.transferred, total: outcome.total,
	})
}

func (f *FileService) emitTransferOutcome(taskID string, outcome transferOutcome) {
	switch outcome.status {
	case "cancelled":
		f.emitTransferCancelled(taskID, outcome.err)
	case "completed":
		f.emitTransferCompleted(taskID, outcome.transferred, outcome.total)
	default:
		if outcome.err == nil {
			outcome.err = errors.New("file transfer failed")
		}
		f.emitTransferError(taskID, outcome.err)
	}
}

func (f *FileService) cancelRegisteredTransfer(cancellation transferCancellation) bool {
	if cancellation.runtime == nil {
		cancelErr := f.performTransferCancellation(cancellation)
		return f.resolveTransfer(nil, cancellation.taskID, func() transferOutcome {
			return cancelledTransferOutcome(cancelErr)
		})
	}
	requested, publish := cancellation.runtime.requestCancellation(func() error {
		return f.performTransferCancellation(cancellation)
	})
	if publish {
		f.emitTransferCancelled(cancellation.taskID)
	}
	return requested
}

func (f *FileService) performTransferCancellation(cancellation transferCancellation) error {
	if cancellation.cancel != nil {
		cancellation.cancel()
	}
	if cancellation.closer == nil {
		return nil
	}
	return f.closeTransferTransport(cancellation)
}

func (f *FileService) closeTransferTransport(cancellation transferCancellation) error {
	if err := cancellation.closer(); err != nil {
		wrapped := fmt.Errorf("close cancelled transfer transport: %w", err)
		if f.logger != nil {
			f.logger.Error("cancel transfer transport close failed", "taskID", cancellation.taskID, "error", err)
		}
		return wrapped
	}
	return nil
}

func (f *FileService) taskRuntime(taskID string) *transferTaskRuntime {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.taskRuntimes[taskID]
}

func (f *FileService) waitForTransfer(runtime *transferTaskRuntime) {
	if runtime != nil {
		<-runtime.done
	}
}
