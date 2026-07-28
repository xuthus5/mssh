package service

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"

	ssh "github.com/xuthus5/mssh/internal/ssh"
)

const maxSystemProbeOutput = 4 * 1024 * 1024

var (
	systemProbeTimeout   = 5 * time.Second
	systemProbeAbortWait = 500 * time.Millisecond
	errProbeOutputLimit  = errors.New("system probe output limit exceeded")
)

type systemProbeResult struct {
	output []byte
	err    error
}

type systemProbeAbortState struct {
	completed <-chan systemProbeResult
	cancelled <-chan error
	cancelErr error
	runErr    error
}

type systemProbeRunner interface {
	Run(command string, output io.Writer) error
	Close() error
}

type sshSystemProbeRunner struct {
	session *gossh.Session
}

func (s *sshSystemProbeRunner) Run(command string, output io.Writer) error {
	s.session.Stdout = output
	s.session.Stderr = output
	return s.session.Run(command)
}

func (s *sshSystemProbeRunner) Close() error {
	return s.session.Close()
}

var _runSystemInfoCommand = runSystemInfoCommand

func runSystemInfoCommand(wrapper *ssh.ClientWrapper, command string) ([]byte, error) {
	if wrapper == nil || wrapper.Inner == nil {
		return nil, errors.New("system info SSH client is unavailable")
	}
	session, err := wrapper.Inner.NewSession()
	if err != nil {
		return nil, fmt.Errorf("system info session: %w", err)
	}
	runner := &sshSystemProbeRunner{session: session}
	defer func() { _ = runner.Close() }()
	output, err := executeSystemProbe(runner, command, maxSystemProbeOutput)
	if err != nil {
		return nil, fmt.Errorf("system info command: %w", err)
	}
	return output, nil
}

func executeSystemProbe(runner systemProbeRunner, command string, maxBytes int) ([]byte, error) {
	if runner == nil {
		return nil, errors.New("system probe runner is required")
	}
	if maxBytes <= 0 {
		return nil, errors.New("system probe output limit must be positive")
	}
	output := newBoundedSystemProbeOutput(maxBytes, runner.Close)
	result, err := waitSystemProbe(func() ([]byte, error) {
		runErr := runner.Run(command, output)
		return output.Bytes(), runErr
	}, runner.Close)
	if output.Exceeded() {
		limitErr := fmt.Errorf("system probe output exceeds %d bytes", maxBytes)
		return nil, errors.Join(limitErr, output.CloseError())
	}
	if err != nil {
		return nil, err
	}
	return result, nil
}

func waitSystemProbe(run func() ([]byte, error), cancel func() error) ([]byte, error) {
	completed := make(chan systemProbeResult, 1)
	go func() { output, err := run(); completed <- systemProbeResult{output: output, err: err} }()
	timer := time.NewTimer(systemProbeTimeout)
	defer timer.Stop()
	select {
	case value := <-completed:
		return value.output, value.err
	case <-timer.C:
		timeoutErr := fmt.Errorf("probe timeout after %s", systemProbeTimeout)
		return waitForSystemProbeAbort(completed, cancel, timeoutErr)
	}
}

func waitForSystemProbeAbort(completed <-chan systemProbeResult, cancel func() error, timeoutErr error) ([]byte, error) {
	state := systemProbeAbortState{completed: completed, cancelled: startSystemProbeCancel(cancel)}
	timer := time.NewTimer(systemProbeAbortWait)
	defer timer.Stop()
	for state.pending() {
		select {
		case value := <-state.completed:
			state.acceptRun(value)
		case cancelResult := <-state.cancelled:
			state.acceptCancel(cancelResult)
		case <-timer.C:
			state.drainReady()
			return nil, state.joinError(timeoutErr)
		}
	}
	return nil, state.joinError(timeoutErr)
}

func startSystemProbeCancel(cancel func() error) <-chan error {
	cancelled := make(chan error, 1)
	if cancel == nil {
		cancelled <- nil
		return cancelled
	}
	go func() { cancelled <- cancel() }()
	return cancelled
}

func (state *systemProbeAbortState) pending() bool {
	return state.completed != nil || state.cancelled != nil
}

func (state *systemProbeAbortState) acceptRun(value systemProbeResult) {
	state.runErr = value.err
	state.completed = nil
}

func (state *systemProbeAbortState) acceptCancel(err error) {
	state.cancelErr = err
	state.cancelled = nil
}

func (state *systemProbeAbortState) drainReady() {
	if state.completed != nil {
		select {
		case value := <-state.completed:
			state.acceptRun(value)
		default:
		}
	}
	if state.cancelled != nil {
		select {
		case err := <-state.cancelled:
			state.acceptCancel(err)
		default:
		}
	}
}

func (state systemProbeAbortState) joinError(timeoutErr error) error {
	pendingErr := systemProbeAbortPendingError(state.completed != nil, state.cancelled != nil)
	return errors.Join(timeoutErr, state.cancelErr, state.runErr, pendingErr)
}

func systemProbeAbortPendingError(runPending, cancelPending bool) error {
	var pendingErr error
	if runPending {
		pendingErr = errors.Join(pendingErr, errors.New("probe runner did not stop after cancellation"))
	}
	if cancelPending {
		pendingErr = errors.Join(pendingErr, errors.New("probe cancellation did not finish"))
	}
	return pendingErr
}

type boundedSystemProbeOutput struct {
	mu        sync.Mutex
	buffer    bytes.Buffer
	maxBytes  int
	exceeded  bool
	close     func() error
	closeOnce sync.Once
	closeErr  error
}

func newBoundedSystemProbeOutput(maxBytes int, close func() error) *boundedSystemProbeOutput {
	return &boundedSystemProbeOutput{maxBytes: maxBytes, close: close}
}

func (o *boundedSystemProbeOutput) Write(content []byte) (int, error) {
	o.mu.Lock()
	remaining := o.maxBytes - o.buffer.Len()
	if len(content) <= remaining {
		written, err := o.buffer.Write(content)
		o.mu.Unlock()
		return written, err
	}
	written, _ := o.buffer.Write(content[:max(remaining, 0)])
	o.exceeded = true
	o.mu.Unlock()
	o.closeOnce.Do(func() {
		if o.close != nil {
			closeErr := o.close()
			o.mu.Lock()
			o.closeErr = closeErr
			o.mu.Unlock()
		}
	})
	return written, errProbeOutputLimit
}

func (o *boundedSystemProbeOutput) Bytes() []byte {
	o.mu.Lock()
	defer o.mu.Unlock()
	return bytes.Clone(o.buffer.Bytes())
}

func (o *boundedSystemProbeOutput) Exceeded() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.exceeded
}

func (o *boundedSystemProbeOutput) CloseError() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.closeErr
}
