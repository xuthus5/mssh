package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestTerminalOutputFlowPausesAndResumesOutput(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 4, testutil.NewTestLogger())
	service.ptys["term-flow"] = nil
	service.attached["term-flow"] = true
	service.outputFlows["term-flow"] = newTerminalOutputFlow()
	require.NoError(t, service.SetOutputPaused("term-flow", true))

	done := make(chan struct{})
	go func() {
		service.handlePTYOutput("term-flow", []byte("output"))
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("paused terminal output should wait for resume")
	case <-time.After(25 * time.Millisecond):
	}

	require.NoError(t, service.SetOutputPaused("term-flow", false))
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("resumed terminal output did not dispatch")
	}
	events := bus.Events()
	require.Len(t, events, 1)
	assert.Equal(t, event.TerminalOutput, events[0].Name)
}

func TestTerminalServiceCloseReleasesPausedOutput(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 4, testutil.NewTestLogger())
	service.ptys["term-close"] = &stubTerminalIO{}
	service.attached["term-close"] = true
	service.outputFlows["term-close"] = newTerminalOutputFlow()
	require.NoError(t, service.SetOutputPaused("term-close", true))

	done := make(chan struct{})
	go func() {
		service.handlePTYOutput("term-close", []byte("output"))
		close(done)
	}()
	require.Eventually(t, func() bool {
		return len(bus.Events()) == 0
	}, time.Second, time.Millisecond)

	require.NoError(t, service.Close("term-close"))
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("closing terminal did not release paused output")
	}
}

func TestTerminalServiceSetOutputPausedTreatsMissingTerminalAsCleanup(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 4, testutil.NewTestLogger())
	require.NoError(t, service.SetOutputPaused("missing", true))
	require.NoError(t, service.SetOutputPaused("missing", false))
	assert.Error(t, service.SetOutputPaused("", true))
}

func TestTerminalServiceAttachReleasesStaleOutputPause(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 4, testutil.NewTestLogger())
	flow := newTerminalOutputFlowWithTimeout(time.Hour)
	service.ptys["term-retry"] = nil
	service.attached["term-retry"] = true
	service.outputFlows["term-retry"] = flow
	flow.pause()

	require.NoError(t, service.Attach("term-retry"))
	done := make(chan bool, 1)
	go func() { done <- flow.wait() }()
	select {
	case open := <-done:
		assert.True(t, open)
	case <-time.After(100 * time.Millisecond):
		t.Fatal("reattaching terminal did not release stale output pause")
	}
	flow.close()
}

func TestTerminalOutputFlowAutomaticallyReleasesExpiredPause(t *testing.T) {
	flow := newTerminalOutputFlowWithTimeout(10 * time.Millisecond)
	flow.pause()

	done := make(chan bool, 1)
	go func() { done <- flow.wait() }()
	select {
	case <-done:
		t.Fatal("pause lease should hold output before it expires")
	case <-time.After(2 * time.Millisecond):
	}

	select {
	case open := <-done:
		assert.True(t, open)
	case <-time.After(time.Second):
		t.Fatal("expired pause lease did not release output")
	}
	flow.close()
}

func TestTerminalOutputFlowLateExpiryAfterCloseIsNoop(t *testing.T) {
	flow := newTerminalOutputFlowWithTimeout(time.Hour)
	flow.pause()
	flow.close()

	flow.expirePause()

	assert.False(t, flow.wait())
}
