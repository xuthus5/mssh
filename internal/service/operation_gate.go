package service

import "sync"

type serviceOperationGate struct {
	mu      sync.Mutex
	workers sync.WaitGroup
	stopped bool
}

func (gate *serviceOperationGate) begin(stoppedErr error) (func(), error) {
	gate.mu.Lock()
	if gate.stopped {
		gate.mu.Unlock()
		return nil, stoppedErr
	}
	gate.workers.Add(1)
	gate.mu.Unlock()
	var finishOnce sync.Once
	return func() {
		finishOnce.Do(gate.workers.Done)
	}, nil
}

func (gate *serviceOperationGate) stopAndWait() {
	gate.stop()
	gate.wait()
}

func (gate *serviceOperationGate) stop() {
	gate.mu.Lock()
	gate.stopped = true
	gate.mu.Unlock()
}

func (gate *serviceOperationGate) wait() {
	gate.workers.Wait()
}
