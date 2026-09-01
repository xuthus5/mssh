package service

import (
	"os"
	"strconv"
	"sync"
	"time"
)

const (
	defaultTerminalBatchIdleTimeout = 2 * time.Millisecond
	defaultTerminalBatchSize        = 16 << 10
	defaultTerminalBatchMaxPending  = 64 << 10
)

// terminalOutputBatchConfig controls backend-side aggregation of PTY output.
// Aggregating small reads into larger events cuts the Wails IPC event storm that
// saturates the frontend main thread (the root cause of input lag and blank lines).
type terminalOutputBatchConfig struct {
	enabled     bool
	idleTimeout time.Duration
	batchSize   int
	maxPending  int
}

func defaultTerminalOutputBatchConfig() terminalOutputBatchConfig {
	return terminalOutputBatchConfig{
		enabled:     true,
		idleTimeout: defaultTerminalBatchIdleTimeout,
		batchSize:   defaultTerminalBatchSize,
		maxPending:  defaultTerminalBatchMaxPending,
	}
}

// terminalOutputBatchConfigFromEnv reads tuning overrides for diagnostics.
// Empty or invalid env values fall back to defaults.
func terminalOutputBatchConfigFromEnv() terminalOutputBatchConfig {
	config := defaultTerminalOutputBatchConfig()
	if os.Getenv("MSSH_TERMINAL_BATCH_DISABLE") == "1" {
		config.enabled = false
		return config
	}
	if value := os.Getenv("MSSH_TERMINAL_BATCH_IDLE_MS"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed >= 0 {
			config.idleTimeout = time.Duration(parsed) * time.Millisecond
		}
	}
	if value := os.Getenv("MSSH_TERMINAL_BATCH_SIZE"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			config.batchSize = parsed
		}
	}
	if value := os.Getenv("MSSH_TERMINAL_BATCH_MAX"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			config.maxPending = parsed
		}
	}
	return config
}

// terminalOutputBatcher accumulates PTY reads and flushes them as a single unit.
// It flushes synchronously once the size threshold is reached, and otherwise on
// an idle timeout so interactive single reads are delivered with minimal delay.
type terminalOutputBatcher struct {
	mu      sync.Mutex
	pending []byte
	timer   *time.Timer
	config  terminalOutputBatchConfig
	flushed func(data []byte)
}

func newTerminalOutputBatcher(config terminalOutputBatchConfig, flushed func([]byte)) *terminalOutputBatcher {
	return &terminalOutputBatcher{config: config, flushed: flushed}
}

func (b *terminalOutputBatcher) push(data []byte) {
	if b == nil || len(data) == 0 {
		return
	}
	b.mu.Lock()
	b.pending = append(b.pending, data...)
	if len(b.pending) >= b.config.maxPending || len(b.pending) >= b.config.batchSize {
		b.mu.Unlock()
		b.flush()
		return
	}
	if b.timer == nil {
		b.timer = time.AfterFunc(b.config.idleTimeout, b.flush)
	}
	b.mu.Unlock()
}

func (b *terminalOutputBatcher) flush() {
	b.mu.Lock()
	if len(b.pending) == 0 {
		b.clearTimerLocked()
		b.mu.Unlock()
		return
	}
	data := b.pending
	b.pending = nil
	b.clearTimerLocked()
	b.mu.Unlock()
	if b.flushed != nil {
		b.flushed(data)
	}
}

// stop discards pending output and cancels the idle timer.
func (b *terminalOutputBatcher) stop() {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.clearTimerLocked()
	b.pending = nil
}

// drain stops the idle timer and flushes any pending output through the
// flushed callback so it is not lost on remote exit.
func (b *terminalOutputBatcher) drain() {
	if b == nil {
		return
	}
	b.mu.Lock()
	data := b.pending
	b.pending = nil
	b.clearTimerLocked()
	b.mu.Unlock()
	if len(data) > 0 && b.flushed != nil {
		b.flushed(data)
	}
}

func (b *terminalOutputBatcher) clearTimerLocked() {
	if b.timer != nil {
		b.timer.Stop()
		b.timer = nil
	}
}

func (t *TerminalService) pushTerminalOutput(terminalID string, data []byte) {
	if len(data) == 0 {
		return
	}
	batcher := t.outputBatcherFor(terminalID)
	if batcher == nil {
		t.handlePTYOutput(terminalID, data)
		return
	}
	batcher.push(data)
}

func (t *TerminalService) outputBatcherFor(terminalID string) *terminalOutputBatcher {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.outputBatchCfg.enabled || !t.attached[terminalID] {
		return nil
	}
	if t.outputBatchers == nil {
		t.outputBatchers = make(map[string]*terminalOutputBatcher)
	}
	batcher := t.outputBatchers[terminalID]
	if batcher == nil {
		batcher = newTerminalOutputBatcher(t.outputBatchCfg, func(data []byte) {
			t.handlePTYOutput(terminalID, data)
		})
		t.outputBatchers[terminalID] = batcher
	}
	return batcher
}

func (t *TerminalService) stopTerminalOutputBatch(terminalID string) {
	t.mu.Lock()
	batcher := t.outputBatchers[terminalID]
	delete(t.outputBatchers, terminalID)
	t.mu.Unlock()
	if batcher != nil {
		batcher.stop()
	}
}

// drainTerminalOutputBatch flushes any batched output before a remote exit so
// the final bytes are not lost. Safe to call for terminals without a batcher.
func (t *TerminalService) drainTerminalOutputBatch(terminalID string) {
	t.mu.Lock()
	batcher := t.outputBatchers[terminalID]
	delete(t.outputBatchers, terminalID)
	t.mu.Unlock()
	if batcher != nil {
		batcher.drain()
	}
}
