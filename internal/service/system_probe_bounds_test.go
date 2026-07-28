package service

import (
	"bytes"
	"errors"
	"io"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExecuteSystemProbeRejectsOversizedOutputAndClosesSession(t *testing.T) {
	runner := &systemProbeRunnerStub{output: bytes.Repeat([]byte("x"), 2048)}

	_, err := executeSystemProbe(runner, "probe", 1024)

	assert.ErrorContains(t, err, "exceeds 1024 bytes")
	assert.Equal(t, 1024, runner.acceptedBytes)
	assert.Equal(t, 1, runner.closeCalls)
}

func TestExecuteSystemProbeAcceptsOutputAtLimit(t *testing.T) {
	runner := &systemProbeRunnerStub{output: bytes.Repeat([]byte("x"), 1024)}

	output, err := executeSystemProbe(runner, "probe", 1024)

	require.NoError(t, err)
	assert.Len(t, output, 1024)
	assert.Equal(t, 1024, runner.acceptedBytes)
	assert.Zero(t, runner.closeCalls)
}

func TestExecuteSystemProbeReturnsCommandError(t *testing.T) {
	runner := &systemProbeRunnerStub{output: []byte("partial"), runErr: assert.AnError}

	_, err := executeSystemProbe(runner, "probe", 1024)

	assert.ErrorIs(t, err, assert.AnError)
}

func TestExecuteSystemProbeRejectsInvalidLimit(t *testing.T) {
	runner := &systemProbeRunnerStub{}

	_, err := executeSystemProbe(runner, "probe", 0)

	assert.ErrorContains(t, err, "positive")
}

func TestExecuteSystemProbePreservesCloseErrorOnOverflow(t *testing.T) {
	runner := &systemProbeRunnerStub{output: bytes.Repeat([]byte("x"), 2048), closeErr: assert.AnError}

	_, err := executeSystemProbe(runner, "probe", 1024)

	assert.ErrorIs(t, err, assert.AnError)
}

func TestBoundedSystemProbeOutputSharesLimitAcrossConcurrentWriters(t *testing.T) {
	output := newBoundedSystemProbeOutput(1024, nil)
	var waitGroup sync.WaitGroup
	for range 4 {
		waitGroup.Go(func() {
			_, _ = output.Write(bytes.Repeat([]byte("x"), 512))
		})
	}
	waitGroup.Wait()

	assert.True(t, output.Exceeded())
	assert.Len(t, output.Bytes(), 1024)
}

type systemProbeRunnerStub struct {
	output        []byte
	runErr        error
	closeErr      error
	acceptedBytes int
	closeCalls    int
}

func (s *systemProbeRunnerStub) Run(_ string, output io.Writer) error {
	written, err := output.Write(s.output)
	s.acceptedBytes += written
	return errors.Join(err, s.runErr)
}

func (s *systemProbeRunnerStub) Close() error {
	s.closeCalls++
	return s.closeErr
}
