package service

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

type batchFlushRecorder struct {
	mu      sync.Mutex
	flushed [][]byte
}

func newBatchFlushRecorder() *batchFlushRecorder {
	return &batchFlushRecorder{}
}

func (r *batchFlushRecorder) record(data []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.flushed = append(r.flushed, append([]byte(nil), data...))
}

func (r *batchFlushRecorder) all() [][]byte {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([][]byte(nil), r.flushed...)
}

func testBatchConfig(idle time.Duration, size int) terminalOutputBatchConfig {
	return terminalOutputBatchConfig{enabled: true, idleTimeout: idle, batchSize: size, maxPending: size * 4}
}

func TestTerminalOutputBatcherFlushesOnSize(t *testing.T) {
	recorder := newBatchFlushRecorder()
	batcher := newTerminalOutputBatcher(testBatchConfig(time.Hour, 5), recorder.record)

	batcher.push([]byte("ab"))
	require.Empty(t, recorder.all())
	batcher.push([]byte("cd"))
	require.Empty(t, recorder.all())
	batcher.push([]byte("e"))

	flushed := recorder.all()
	require.Len(t, flushed, 1)
	assert.Equal(t, "abcde", string(flushed[0]))
}

func TestTerminalOutputBatcherFlushesOnIdle(t *testing.T) {
	recorder := newBatchFlushRecorder()
	batcher := newTerminalOutputBatcher(testBatchConfig(10*time.Millisecond, 1<<20), recorder.record)

	batcher.push([]byte("hello"))
	require.Empty(t, recorder.all())
	require.Eventually(t, func() bool { return len(recorder.all()) == 1 }, time.Second, 2*time.Millisecond)
	assert.Equal(t, "hello", string(recorder.all()[0]))
}

func TestTerminalOutputBatcherAggregatesRapidChunks(t *testing.T) {
	recorder := newBatchFlushRecorder()
	batcher := newTerminalOutputBatcher(testBatchConfig(20*time.Millisecond, 1<<20), recorder.record)

	batcher.push([]byte("a"))
	batcher.push([]byte("b"))
	batcher.push([]byte("c"))

	require.Empty(t, recorder.all())
	require.Eventually(t, func() bool { return len(recorder.all()) == 1 }, time.Second, 2*time.Millisecond)
	assert.Equal(t, "abc", string(recorder.all()[0]))
}

func TestTerminalOutputBatcherStopDiscardsPending(t *testing.T) {
	recorder := newBatchFlushRecorder()
	batcher := newTerminalOutputBatcher(testBatchConfig(10*time.Millisecond, 1<<20), recorder.record)

	batcher.push([]byte("data"))
	batcher.stop()
	time.Sleep(30 * time.Millisecond)
	assert.Empty(t, recorder.all())
}

func TestTerminalOutputBatcherEmptyPushNoop(t *testing.T) {
	recorder := newBatchFlushRecorder()
	batcher := newTerminalOutputBatcher(testBatchConfig(time.Hour, 1<<20), recorder.record)

	batcher.push(nil)
	batcher.push([]byte{})
	assert.Empty(t, recorder.all())
	batcher.stop()
}

func TestTerminalOutputBatcherNilIsSafe(t *testing.T) {
	var batcher *terminalOutputBatcher
	batcher.push([]byte("x"))
	assert.NotPanics(t, func() { batcher.stop() })
}

func TestTerminalOutputBatchConfigFromEnv(t *testing.T) {
	t.Setenv("MSSH_TERMINAL_BATCH_IDLE_MS", "25")
	t.Setenv("MSSH_TERMINAL_BATCH_SIZE", "4096")
	t.Setenv("MSSH_TERMINAL_BATCH_MAX", "16384")
	config := terminalOutputBatchConfigFromEnv()
	assert.True(t, config.enabled)
	assert.Equal(t, 25*time.Millisecond, config.idleTimeout)
	assert.Equal(t, 4096, config.batchSize)
	assert.Equal(t, 16384, config.maxPending)
}

func TestTerminalOutputBatchConfigFromEnvDisable(t *testing.T) {
	t.Setenv("MSSH_TERMINAL_BATCH_DISABLE", "1")
	config := terminalOutputBatchConfigFromEnv()
	assert.False(t, config.enabled)
}

func TestTerminalOutputBatchConfigFromEnvDefaults(t *testing.T) {
	config := terminalOutputBatchConfigFromEnv()
	assert.True(t, config.enabled)
	assert.Equal(t, defaultTerminalBatchIdleTimeout, config.idleTimeout)
	assert.Equal(t, defaultTerminalBatchSize, config.batchSize)
	assert.Equal(t, defaultTerminalBatchMaxPending, config.maxPending)
}

func TestTerminalOutputBatchConfigFromEnvIgnoresInvalid(t *testing.T) {
	t.Setenv("MSSH_TERMINAL_BATCH_IDLE_MS", "abc")
	t.Setenv("MSSH_TERMINAL_BATCH_SIZE", "-5")
	config := terminalOutputBatchConfigFromEnv()
	assert.Equal(t, defaultTerminalBatchIdleTimeout, config.idleTimeout)
	assert.Equal(t, defaultTerminalBatchSize, config.batchSize)
}

func TestTerminalOutputBatchingAggregatesReads(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.outputBatchCfg = testBatchConfig(20*time.Millisecond, 1<<20)
	service.ptys["term-1"] = nil
	service.attached["term-1"] = true

	service.pushTerminalOutput("term-1", []byte("a"))
	service.pushTerminalOutput("term-1", []byte("b"))
	service.pushTerminalOutput("term-1", []byte("c"))

	require.Empty(t, bus.Events())
	require.Eventually(t, func() bool { return len(bus.Events()) == 1 }, time.Second, 2*time.Millisecond)

	events := bus.Events()
	require.Len(t, events, 1)
	payload := events[0].Payload.(event.TerminalOutputPayload)
	assert.Equal(t, "abc", string(payload.Data))
	assert.Equal(t, uint64(1), payload.Sequence)
}

func TestTerminalOutputBatchingFlushesOnSize(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.outputBatchCfg = testBatchConfig(time.Hour, 5)
	service.ptys["term-1"] = nil
	service.attached["term-1"] = true

	service.pushTerminalOutput("term-1", []byte("a"))
	service.pushTerminalOutput("term-1", []byte("b"))
	service.pushTerminalOutput("term-1", []byte("c"))
	service.pushTerminalOutput("term-1", []byte("d"))
	require.Empty(t, bus.Events())
	service.pushTerminalOutput("term-1", []byte("e"))

	events := bus.Events()
	require.Len(t, events, 1)
	assert.Equal(t, "abcde", string(events[0].Payload.(event.TerminalOutputPayload).Data))
}

func TestTerminalOutputBatcherDrainFlushesPending(t *testing.T) {
	recorder := newBatchFlushRecorder()
	batcher := newTerminalOutputBatcher(testBatchConfig(time.Hour, 1<<20), recorder.record)

	batcher.push([]byte("final"))
	batcher.drain()
	flushed := recorder.all()
	require.Len(t, flushed, 1)
	assert.Equal(t, "final", string(flushed[0]))
	batcher.drain()
	assert.Len(t, recorder.all(), 1)
}

func TestTerminalOutputBatcherDrainNilIsSafe(t *testing.T) {
	var batcher *terminalOutputBatcher
	assert.NotPanics(t, func() { batcher.drain() })
}

func TestTerminalOutputBatchingOnlyWhenAttached(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.outputBatchCfg = testBatchConfig(time.Hour, 1<<20)
	service.ptys["term-1"] = nil

	service.pushTerminalOutput("term-1", []byte("unattached"))
	assert.Empty(t, bus.Events())
	service.mu.Lock()
	pending := service.pendingOutput["term-1"]
	batcherCount := len(service.outputBatchers)
	service.mu.Unlock()
	assert.Equal(t, "unattached", string(pending))
	assert.Equal(t, 0, batcherCount)
}

func TestDrainTerminalOutputBatchFlushesOnRemoteExit(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.outputBatchCfg = testBatchConfig(time.Hour, 1<<20)
	service.ptys["term-1"] = nil
	service.attached["term-1"] = true

	service.pushTerminalOutput("term-1", []byte("before-exit"))
	require.Empty(t, bus.Events())
	service.drainTerminalOutputBatch("term-1")

	events := bus.Events()
	require.Len(t, events, 1)
	assert.Equal(t, "before-exit", string(events[0].Payload.(event.TerminalOutputPayload).Data))
}

func TestTerminalOutputBatcherFlushEmptyNoop(t *testing.T) {
	recorder := newBatchFlushRecorder()
	batcher := newTerminalOutputBatcher(testBatchConfig(time.Hour, 1<<20), recorder.record)
	batcher.flush()
	batcher.flush()
	assert.Empty(t, recorder.all())
	batcher.stop()
}

func TestPushTerminalOutputEmptyDataNoop(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.outputBatchCfg = testBatchConfig(time.Hour, 1<<20)
	service.ptys["term-1"] = nil
	service.attached["term-1"] = true

	assert.NotPanics(t, func() { service.pushTerminalOutput("term-1", nil) })
	assert.NotPanics(t, func() { service.pushTerminalOutput("term-1", []byte{}) })
	assert.Empty(t, bus.Events())
}

func TestTerminalOutputBatchingDisabledFlushesImmediately(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.outputBatchCfg = terminalOutputBatchConfig{enabled: false}
	service.ptys["term-1"] = nil
	service.attached["term-1"] = true

	service.pushTerminalOutput("term-1", []byte("a"))
	events := bus.Events()
	require.Len(t, events, 1)
	assert.Equal(t, "a", string(events[0].Payload.(event.TerminalOutputPayload).Data))
}

func TestStopTerminalOutputBatchDiscardsPending(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.outputBatchCfg = testBatchConfig(10*time.Millisecond, 1<<20)
	service.ptys["term-1"] = nil
	service.attached["term-1"] = true

	service.pushTerminalOutput("term-1", []byte("pending"))
	service.stopTerminalOutputBatch("term-1")
	time.Sleep(30 * time.Millisecond)
	assert.Empty(t, bus.Events())
}

func TestStopTerminalOutputBatchMissingTerminalIsNoop(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 32, testutil.NewTestLogger())
	assert.NotPanics(t, func() { service.stopTerminalOutputBatch("missing") })
}
