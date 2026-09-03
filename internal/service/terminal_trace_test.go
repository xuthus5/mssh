package service

import (
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type traceBuffer struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (b *traceBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *traceBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func newDebugTraceLogger() (*slog.Logger, *traceBuffer) {
	buffer := &traceBuffer{}
	logger := slog.New(slog.NewTextHandler(buffer, &slog.HandlerOptions{Level: slog.LevelDebug}))
	return logger, buffer
}

func TestTerminalTraceEnabled(t *testing.T) {
	logger, _ := newDebugTraceLogger()
	enabled := (&TerminalService{logger: logger}).terminalTraceEnabled()
	assert.True(t, enabled)

	info := slog.New(slog.NewTextHandler(&traceBuffer{}, &slog.HandlerOptions{Level: slog.LevelInfo}))
	assert.False(t, (&TerminalService{logger: info}).terminalTraceEnabled())
	assert.False(t, (&TerminalService{}).terminalTraceEnabled())
}

func TestTerminalTraceWriteLogsWithDebugLogger(t *testing.T) {
	logger, buffer := newDebugTraceLogger()
	service := &TerminalService{logger: logger}

	start := service.traceWriteStarted("term-1", []byte("ab"))
	require.False(t, start.IsZero())
	assert.Contains(t, buffer.String(), "terminal write start")
	assert.Contains(t, buffer.String(), "write_seq=1")

	service.traceWriteStarted("term-1", []byte("c"))
	service.traceWriteFinished("term-1", start, 2)
	output := buffer.String()
	assert.Contains(t, output, "write_seq=2")
	assert.Contains(t, output, "terminal write done")
	assert.Contains(t, output, "bytes=2")
	assert.Contains(t, output, "elapsed_ms=")

	service.traceMu.Lock()
	doneAt, exists := service.lastWriteDone["term-1"]
	service.traceMu.Unlock()
	assert.True(t, exists)
	assert.False(t, doneAt.IsZero())
}

func TestTerminalTraceOutputReadComputesLatencies(t *testing.T) {
	logger, buffer := newDebugTraceLogger()
	service := &TerminalService{logger: logger}

	service.traceWriteStarted("term-1", []byte("x"))
	service.traceWriteFinished("term-1", time.Now(), 1)
	service.traceOutputRead("term-1", []byte("a"))
	service.traceOutputRead("term-1", []byte("b"))

	output := buffer.String()
	assert.Contains(t, output, "terminal output read")
	assert.Contains(t, output, "since_last_write_ms=")
	assert.Contains(t, output, "since_last_output_ms=")
	assert.NotContains(t, output, "preview=")
}

func TestTerminalTraceOutputReadHandlesMissingWrite(t *testing.T) {
	logger, buffer := newDebugTraceLogger()
	service := &TerminalService{logger: logger}

	service.traceOutputRead("term-2", []byte("bg"))
	output := buffer.String()
	assert.Contains(t, output, "terminal output read")
	assert.NotContains(t, output, "since_last_write_ms")
	assert.NotContains(t, output, "since_last_output_ms")
}

func TestTerminalTraceOutputDispatchedLogsSequence(t *testing.T) {
	logger, buffer := newDebugTraceLogger()
	service := &TerminalService{logger: logger, outputSequences: map[string]uint64{"term-1": 7}}

	service.traceOutputDispatched("term-1", []byte("data"), time.Now())
	output := buffer.String()
	assert.Contains(t, output, "terminal output dispatched")
	assert.Contains(t, output, "seq=7")
	assert.Contains(t, output, "dispatch_ms=")
}

func TestTerminalTraceFlowWaitMeasuresBlockedReader(t *testing.T) {
	logger, buffer := newDebugTraceLogger()
	service := &TerminalService{logger: logger}

	flow := newTerminalOutputFlow()
	flow.pause()
	done := make(chan struct{})
	go func() {
		assert.True(t, service.traceFlowWait("term-1", flow))
		close(done)
	}()
	time.Sleep(5 * time.Millisecond)
	flow.resume()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("traceFlowWait did not return after resume")
	}
	assert.Contains(t, buffer.String(), "terminal output flow wait")
	assert.Contains(t, buffer.String(), "waited_ms=")
}

func TestTerminalTraceFlowWaitClosedFlow(t *testing.T) {
	service := &TerminalService{logger: mustDebugLogger(t)}
	flow := newTerminalOutputFlow()
	flow.pause()
	flow.close()
	assert.False(t, service.traceFlowWait("term-1", flow))
}

func TestTerminalTraceCleanupRemovesPerTerminalState(t *testing.T) {
	logger, _ := newDebugTraceLogger()
	service := &TerminalService{logger: logger,
		writeSerials:  map[string]uint64{"term-1": 3},
		lastWriteDone: map[string]time.Time{"term-1": time.Now()},
		lastOutputAt:  map[string]time.Time{"term-1": time.Now()},
	}

	service.cleanupTerminalTrace("term-1")
	service.traceMu.Lock()
	defer service.traceMu.Unlock()
	assert.NotContains(t, service.writeSerials, "term-1")
	assert.NotContains(t, service.lastWriteDone, "term-1")
	assert.NotContains(t, service.lastOutputAt, "term-1")
}

func TestTerminalTraceDisabledLoggerIsNoop(t *testing.T) {
	buffer := &traceBuffer{}
	logger := slog.New(slog.NewTextHandler(buffer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	service := &TerminalService{logger: logger}

	start := service.traceWriteStarted("term-1", []byte("x"))
	assert.True(t, start.IsZero())
	service.traceWriteFinished("term-1", start, 1)
	service.traceOutputRead("term-1", []byte("x"))
	service.traceOutputDispatched("term-1", []byte("x"), time.Now())

	assert.Empty(t, buffer.String())
	assert.Nil(t, service.lastWriteDone)
	assert.Nil(t, service.lastOutputAt)
	assert.Nil(t, service.writeSerials)
}

func TestTerminalTraceNilLoggerIsNoop(t *testing.T) {
	service := &TerminalService{}
	assert.False(t, service.terminalTraceEnabled())
	assert.True(t, service.traceFlowWait("term-1", newTerminalOutputFlow()))
	assert.True(t, service.traceWriteStarted("term-1", []byte("x")).IsZero())
	service.cleanupTerminalTrace("term-1")
}

func mustDebugLogger(t *testing.T) *slog.Logger {
	t.Helper()
	logger, _ := newDebugTraceLogger()
	return logger
}

func TestWriteEmitsDebugTraceWithDebugLogger(t *testing.T) {
	logger, buffer := newDebugTraceLogger()
	service := &TerminalService{logger: logger,
		ptys:     map[string]terminalIO{"term-1": &traceWritePTY{}},
		lastUsed: make(map[string]time.Time),
	}

	_, err := service.Write("term-1", "ok")
	require.NoError(t, err)
	output := buffer.String()
	assert.Contains(t, output, "terminal write start")
	assert.Contains(t, output, "terminal write done")
}

type traceWritePTY struct {
	written []byte
}

func (p *traceWritePTY) Write(data []byte) (int, error) {
	p.written = append(p.written, data...)
	return len(data), nil
}

func (p *traceWritePTY) Resize(cols, rows int) error { return nil }

func (p *traceWritePTY) Close() error { return nil }

func (p *traceWritePTY) SetReadCallback(fn func([]byte)) {}

func (p *traceWritePTY) SetExitCallback(fn func(error)) {}

func (p *traceWritePTY) Start() {}

func TestSinceMillis(t *testing.T) {
	from := time.Now()
	assert.InDelta(t, 5, sinceMillis(from, from.Add(5*time.Millisecond)), 1)
}

func TestEscapeTerminalPreview(t *testing.T) {
	assert.Equal(t, `root@x-dev:~# `, escapeTerminalPreview([]byte("root@x-dev:~# "), 160))
	assert.Equal(t, `\r\n`, escapeTerminalPreview([]byte("\r\n"), 160))
	assert.Equal(t, `\e[0m`, escapeTerminalPreview([]byte{0x1b, '[', '0', 'm'}, 160))
	assert.Equal(t, `\x00\x01\xff`, escapeTerminalPreview([]byte{0, 1, 0xff}, 160))
	assert.Equal(t, `ab`, escapeTerminalPreview([]byte("abcdef"), 2))
}
