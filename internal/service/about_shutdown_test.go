package service

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type blockingUpdateRoundTripper struct {
	startedOnce  sync.Once
	canceledOnce sync.Once
	started      chan struct{}
	canceled     chan struct{}
	release      chan struct{}
	calls        atomic.Int32
}

func (transport *blockingUpdateRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	transport.calls.Add(1)
	transport.startedOnce.Do(func() { close(transport.started) })
	<-request.Context().Done()
	transport.canceledOnce.Do(func() { close(transport.canceled) })
	<-transport.release
	return nil, request.Context().Err()
}

func TestAboutServiceShutdownCancelsWaitsAndRejectsNewChecks(t *testing.T) {
	transport := &blockingUpdateRoundTripper{
		started: make(chan struct{}), canceled: make(chan struct{}), release: make(chan struct{}),
	}
	service := NewAboutService()
	service.client.Transport = transport

	requestDone := make(chan error, 1)
	go func() {
		_, err := service.CheckUpdate(t.Context())
		requestDone <- err
	}()
	<-transport.started

	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()
	select {
	case <-transport.canceled:
	case <-time.After(time.Second):
		t.Fatal("about service shutdown did not cancel the active update check")
	}
	select {
	case <-shutdownDone:
		t.Fatal("about service shutdown returned before the active update check completed")
	case <-time.After(50 * time.Millisecond):
	}

	close(transport.release)
	require.ErrorContains(t, <-requestDone, context.Canceled.Error())
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("about service shutdown did not finish after the update check completed")
	}

	_, err := service.CheckUpdate(t.Context())
	require.ErrorContains(t, err, "about service is shutting down")
	assert.Equal(t, int32(1), transport.calls.Load())
	service.Shutdown()
}

func TestNilAboutServiceShutdown(t *testing.T) {
	var service *AboutService
	assert.NotPanics(t, service.Shutdown)
	_, err := service.CheckUpdate(t.Context())
	require.ErrorContains(t, err, "about service is shutting down")
}

func TestAboutServiceCheckUpdateRequiresContext(t *testing.T) {
	_, err := NewAboutService().CheckUpdate(nil)
	require.ErrorContains(t, err, "update check context is required")
}
