package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// terminalTraceEnabled reports whether debug-level terminal tracing is active.
// All trace helpers no-op when disabled so production hot paths stay untouched.
func (t *TerminalService) terminalTraceEnabled() bool {
	return t.logger != nil && t.logger.Enabled(context.Background(), slog.LevelDebug)
}

func sinceMillis(from, to time.Time) float64 {
	return float64(to.Sub(from)) / float64(time.Millisecond)
}

// escapeTerminalPreview renders a compact escaped preview of terminal output for
// diagnostics. Non-printable bytes are escaped so newline/CR/ESC are visible.
func escapeTerminalPreview(data []byte, max int) string {
	if len(data) > max {
		data = data[:max]
	}
	var builder strings.Builder
	builder.Grow(len(data) + 16)
	for _, b := range data {
		switch {
		case b == 0x1b:
			builder.WriteString(`\e`)
		case b == '\r':
			builder.WriteString(`\r`)
		case b == '\n':
			builder.WriteString(`\n`)
		case b == '\t':
			builder.WriteString(`\t`)
		case b >= 0x20 && b < 0x7f:
			builder.WriteByte(b)
		default:
			fmt.Fprintf(&builder, `\x%02x`, b)
		}
	}
	return builder.String()
}

// traceWriteStarted records the arrival of a terminal Write binding call.
func (t *TerminalService) traceWriteStarted(terminalID string, data []byte) time.Time {
	if !t.terminalTraceEnabled() {
		return time.Time{}
	}
	start := time.Now()
	t.traceMu.Lock()
	if t.writeSerials == nil {
		t.writeSerials = make(map[string]uint64)
	}
	t.writeSerials[terminalID]++
	seq := t.writeSerials[terminalID]
	t.traceMu.Unlock()
	t.logger.Debug("terminal write start", "terminalID", terminalID, "len", len(data), "write_seq", seq)
	return start
}

// traceWriteFinished records pty.Write completion and its duration.
func (t *TerminalService) traceWriteFinished(terminalID string, start time.Time, bytesWritten int) {
	if !t.terminalTraceEnabled() {
		return
	}
	now := time.Now()
	t.traceMu.Lock()
	if t.lastWriteDone == nil {
		t.lastWriteDone = make(map[string]time.Time)
	}
	t.lastWriteDone[terminalID] = now
	t.traceMu.Unlock()
	t.logger.Debug("terminal write done",
		"terminalID", terminalID,
		"bytes", bytesWritten,
		"elapsed_ms", sinceMillis(start, now))
}

// traceOutputRead records remote PTY output arrival. since_last_write_ms
// approximates the input-to-echo round trip during interactive typing.
func (t *TerminalService) traceOutputRead(terminalID string, data []byte) {
	if !t.terminalTraceEnabled() {
		return
	}
	now := time.Now()
	t.traceMu.Lock()
	lastWrite := t.lastWriteDone[terminalID]
	lastOutput := t.lastOutputAt[terminalID]
	if t.lastOutputAt == nil {
		t.lastOutputAt = make(map[string]time.Time)
	}
	t.lastOutputAt[terminalID] = now
	t.traceMu.Unlock()
	attrs := []any{"terminalID", terminalID, "len", len(data)}
	if !lastWrite.IsZero() {
		attrs = append(attrs, "since_last_write_ms", sinceMillis(lastWrite, now))
	}
	if !lastOutput.IsZero() {
		attrs = append(attrs, "since_last_output_ms", sinceMillis(lastOutput, now))
	}
	t.logger.Debug("terminal output read", attrs...)
}

// traceOutputDispatched records how long live output spent before being handed
// to the event bus. A large value indicates lock contention on the dispatcher.
func (t *TerminalService) traceOutputDispatched(terminalID string, data []byte, start time.Time) {
	if !t.terminalTraceEnabled() {
		return
	}
	t.outputMu.Lock()
	seq := t.outputSequences[terminalID]
	t.outputMu.Unlock()
	t.logger.Debug("terminal output dispatched",
		"terminalID", terminalID,
		"seq", seq,
		"len", len(data),
		"dispatch_ms", sinceMillis(start, time.Now()))
}

// traceFlowWait measures how long the PTY reader blocks on output backpressure.
func (t *TerminalService) traceFlowWait(terminalID string, flow *terminalOutputFlow) bool {
	if !t.terminalTraceEnabled() {
		return flow.wait()
	}
	start := time.Now()
	open := flow.wait()
	t.logger.Debug("terminal output flow wait",
		"terminalID", terminalID,
		"waited_ms", sinceMillis(start, time.Now()),
		"open", open)
	return open
}

// cleanupTerminalTrace drops per-terminal trace state after close.
func (t *TerminalService) cleanupTerminalTrace(terminalID string) {
	t.traceMu.Lock()
	delete(t.writeSerials, terminalID)
	delete(t.lastWriteDone, terminalID)
	delete(t.lastOutputAt, terminalID)
	t.traceMu.Unlock()
}
