package main

import (
	"bytes"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
)

type stubRuntimeShutdowner struct {
	calls int
	trace *[]string
}

func (s *stubRuntimeShutdowner) Shutdown() {
	s.calls++
	if s.trace != nil {
		*s.trace = append(*s.trace, "application")
	}
}

type stubRuntimeLogCloser struct {
	calls int
	err   error
	trace *[]string
}

func (s *stubRuntimeLogCloser) Close() error {
	s.calls++
	if s.trace != nil {
		*s.trace = append(*s.trace, "log")
	}
	return s.err
}

func TestShutdownRuntimeClosesApplicationBeforeLog(t *testing.T) {
	trace := make([]string, 0, 2)
	application := &stubRuntimeShutdowner{trace: &trace}
	logCloser := &stubRuntimeLogCloser{trace: &trace}

	shutdownRuntime(application, logCloser, &bytes.Buffer{})

	assert.Equal(t, 1, application.calls)
	assert.Equal(t, 1, logCloser.calls)
	assert.Equal(t, []string{"application", "log"}, trace)
}

func TestShutdownRuntimeReportsLogCloseFailure(t *testing.T) {
	logCloser := &stubRuntimeLogCloser{err: errors.New("flush failed")}
	var stderr bytes.Buffer

	shutdownRuntime(nil, logCloser, &stderr)

	assert.Equal(t, 1, logCloser.calls)
	assert.Contains(t, stderr.String(), "close application log failed")
	assert.Contains(t, stderr.String(), "flush failed")
}

func TestShutdownRuntimeAcceptsNilResources(t *testing.T) {
	assert.NotPanics(t, func() {
		shutdownRuntime(nil, nil, &bytes.Buffer{})
	})
	assert.NotPanics(t, func() {
		shutdownRuntime(nil, &stubRuntimeLogCloser{err: errors.New("close failed")}, nil)
	})
}
