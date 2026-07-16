package service

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/model"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/pkg/event"
)

type TerminalService struct {
	mu            sync.RWMutex
	outputMu      sync.Mutex
	ptys          map[string]*ssh.PTYSession
	connIDs       map[string]string
	attached      map[string]bool
	pendingOutput map[string][]byte
	eventBus      EventBus
	maxSize       int
	lastUsed      map[string]time.Time
	sessionSvc    *SessionService
	outputHandler func(terminalID string, data []byte)
	closeHandler  func(terminalID string)
	systemMu      sync.Mutex
	systemSamples map[string]systemSample
	logger        *slog.Logger
}

var _openPTY = ssh.PreparePTY

const maxSystemProbeOutput = 4 * 1024 * 1024

var systemProbeTimeout = 5 * time.Second

var _runSystemInfoCommand = func(wrapper *ssh.ClientWrapper, command string) ([]byte, error) {
	session, err := wrapper.Inner.NewSession()
	if err != nil {
		return nil, fmt.Errorf("system info session: %w", err)
	}
	defer func() { _ = session.Close() }()
	output, err := waitSystemProbe(func() ([]byte, error) { return session.CombinedOutput(command) }, session.Close)
	if err != nil {
		return nil, fmt.Errorf("system info command: %w", err)
	}
	if len(output) > maxSystemProbeOutput {
		return nil, fmt.Errorf("system info command: output exceeds %d bytes", maxSystemProbeOutput)
	}
	return output, nil
}

func waitSystemProbe(run func() ([]byte, error), cancel func() error) ([]byte, error) {
	type result struct {
		output []byte
		err    error
	}
	completed := make(chan result, 1)
	go func() { output, err := run(); completed <- result{output: output, err: err} }()
	timer := time.NewTimer(systemProbeTimeout)
	defer timer.Stop()
	select {
	case value := <-completed:
		return value.output, value.err
	case <-timer.C:
		_ = cancel()
		return nil, fmt.Errorf("probe timeout after %s", systemProbeTimeout)
	}
}

func (t *TerminalService) SetOutputHandler(fn func(terminalID string, data []byte)) {
	t.mu.Lock()
	t.outputHandler = fn
	t.mu.Unlock()
}

func (t *TerminalService) SetCloseHandler(fn func(terminalID string)) {
	t.mu.Lock()
	t.closeHandler = fn
	t.mu.Unlock()
}

func NewTerminalService(sessionSvc *SessionService, eventBus EventBus, maxSize int, logger *slog.Logger) *TerminalService {
	if maxSize <= 0 {
		maxSize = 32
	}
	return &TerminalService{
		ptys:          make(map[string]*ssh.PTYSession),
		connIDs:       make(map[string]string),
		attached:      make(map[string]bool),
		pendingOutput: make(map[string][]byte),
		eventBus:      eventBus,
		maxSize:       maxSize,
		lastUsed:      make(map[string]time.Time),
		sessionSvc:    sessionSvc,
		logger:        logger,
		systemSamples: make(map[string]systemSample),
	}
}

type systemSample struct {
	total, idle, received, transmitted uint64
	at                                 time.Time
}

func (t *TerminalService) SystemInfo(terminalID string) (*model.SystemInfo, error) {
	t.mu.RLock()
	connID, ok := t.connIDs[terminalID]
	t.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("terminal %s not found", terminalID)
	}
	wrapper, err := t.sessionSvc.GetClientWrapper(connID)
	if err != nil {
		return nil, err
	}
	command := `printf 'LOAD '; cat /proc/loadavg; printf 'UPTIME '; cat /proc/uptime; printf 'KERNEL '; uname -r; awk -F= '/^PRETTY_NAME=/ {gsub(/"/,"",$2); print "OS",$2}' /etc/os-release 2>/dev/null; awk '/^cpu / {print "CPU", $2+$3+$4+$5+$6+$7+$8+$9, $5+$6} /^MemTotal:/ {print "MEMTOTAL", $2*1024} /^MemAvailable:/ {print "MEMAVAILABLE", $2*1024} /^SwapTotal:/ {print "SWAPTOTAL", $2*1024} /^SwapFree:/ {print "SWAPFREE", $2*1024}' /proc/stat /proc/meminfo; awk 'NR>2 {rx+=$2; tx+=$10} END {print "NET", rx, tx}' /proc/net/dev; df -P -B1 / | awk 'NR==2 {print "DISK", $3, $2}'; nproc`
	output, err := _runSystemInfoCommand(wrapper, command)
	if err != nil {
		return nil, err
	}
	values := strings.Fields(string(output))
	info, sample, err := parseSystemInfo(values)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	t.systemMu.Lock()
	previous, exists := t.systemSamples[terminalID]
	t.systemSamples[terminalID] = systemSample{total: sample.total, idle: sample.idle, received: sample.received, transmitted: sample.transmitted, at: now}
	t.systemMu.Unlock()
	if exists {
		elapsed := now.Sub(previous.at).Seconds()
		if elapsed > 0 {
			info.CPUPercent = cpuPercent(previous, sample)
			info.DownloadRate = uint64(float64(sample.received-previous.received) / elapsed)
			info.UploadRate = uint64(float64(sample.transmitted-previous.transmitted) / elapsed)
		}
	}
	return info, nil
}

func (t *TerminalService) ProcessInfo(terminalID string) ([]model.ProcessInfo, error) {
	t.mu.RLock()
	connID, ok := t.connIDs[terminalID]
	t.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("terminal %s not found", terminalID)
	}
	wrapper, err := t.sessionSvc.GetClientWrapper(connID)
	if err != nil {
		return nil, err
	}
	output, err := _runSystemInfoCommand(wrapper, `ps -eo pid=,ppid=,user=,state=,%cpu=,rss=,comm= --sort=-%cpu`)
	if err != nil {
		return nil, err
	}
	processes := make([]model.ProcessInfo, 0)
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}
		pid, e1 := strconv.ParseInt(fields[0], 10, 64)
		ppid, e2 := strconv.ParseInt(fields[1], 10, 64)
		cpu, e3 := strconv.ParseFloat(fields[4], 64)
		rss, e4 := strconv.ParseUint(fields[5], 10, 64)
		if e1 != nil || e2 != nil || e3 != nil || e4 != nil {
			continue
		}
		processes = append(processes, model.ProcessInfo{PID: pid, PPID: ppid, User: fields[2], State: fields[3], CPUPercent: cpu, RSSBytes: rss * 1024, MemoryBytes: rss * 1024, Command: strings.Join(fields[6:], " ")})
	}
	return processes, nil
}

func parseSystemInfo(values []string) (*model.SystemInfo, systemSample, error) {
	if len(values) < 14 {
		return nil, systemSample{}, fmt.Errorf("invalid system info response")
	}
	result := &model.SystemInfo{}
	sample := systemSample{}
	for index := 0; index < len(values); {
		consumed := parseSystemInfoField(result, &sample, values[index:])
		if consumed < 0 {
			return nil, systemSample{}, fmt.Errorf("invalid system info field %s", values[index])
		}
		if consumed == 0 {
			result.CPUCount, _ = strconv.Atoi(values[index])
			consumed = 1
		}
		index += consumed
	}
	return result, sample, nil
}

func parseSystemInfoField(result *model.SystemInfo, sample *systemSample, values []string) int {
	if len(values) < 2 {
		return 0
	}
	uint := func(value string) uint64 { parsed, _ := strconv.ParseUint(value, 10, 64); return parsed }
	float := func(value string) float64 { parsed, _ := strconv.ParseFloat(value, 64); return parsed }
	if consumed := parseWideSystemInfoField(result, sample, values, uint, float); consumed != 0 {
		return consumed
	}
	switch values[0] {
	case "MEMTOTAL":
		result.MemoryTotal = uint(values[1])
		return 2
	case "MEMAVAILABLE":
		result.MemoryUsed = result.MemoryTotal - uint(values[1])
		return 2
	case "UPTIME":
		result.UptimeSeconds = int64(float(values[1]))
		return 2
	case "KERNEL":
		result.KernelVersion = values[1]
		return 2
	case "OS":
		result.OSName = values[1]
		return 2
	case "SWAPTOTAL":
		result.SwapTotal = uint(values[1])
		return 2
	case "SWAPFREE":
		free := uint(values[1])
		if result.SwapTotal >= free {
			result.SwapUsed = result.SwapTotal - free
		}
		return 2
	}
	return 0
}

func parseWideSystemInfoField(result *model.SystemInfo, sample *systemSample, values []string, uint func(string) uint64, float func(string) float64) int {
	switch values[0] {
	case "CPU":
		if len(values) < 3 {
			return -1
		}
		sample.total, sample.idle = uint(values[1]), uint(values[2])
		return 3
	case "NET":
		if len(values) < 3 {
			return -1
		}
		sample.received, sample.transmitted = uint(values[1]), uint(values[2])
		return 3
	case "DISK":
		if len(values) < 3 {
			return -1
		}
		result.DiskUsed, result.DiskTotal = uint(values[1]), uint(values[2])
		return 3
	case "LOAD":
		if len(values) < 4 {
			return -1
		}
		result.Load1, result.Load5, result.Load15 = float(values[1]), float(values[2]), float(values[3])
		return 4
	}
	return 0
}

func cpuPercent(previous, current systemSample) float64 {
	total := current.total - previous.total
	idle := current.idle - previous.idle
	if total == 0 || idle > total {
		return 0
	}
	return float64(total-idle) / float64(total) * 100
}

func (t *TerminalService) Open(ctx context.Context, sessionID int64, cols, rows int) (string, error) {
	t.logger.Info("opening terminal", "sessionID", sessionID, "cols", cols, "rows", rows)
	connID, err := t.sessionSvc.connect(ctx, sessionID, false)
	if err != nil {
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	wrapper, err := t.sessionSvc.GetClientWrapper(connID)
	if err != nil {
		_ = t.sessionSvc.disconnect(connID, false)
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	sess, err := t.sessionSvc.GetSession(sessionID)
	if err != nil {
		_ = t.sessionSvc.disconnect(connID, false)
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	termType := sess.TermType
	if termType == "" {
		termType = "xterm-256color"
	}

	terminalID := uuid.New().String()
	pty, err := _openPTY(wrapper, termType, cols, rows)
	if err != nil {
		_ = t.sessionSvc.disconnect(connID, false)
		t.logger.Error("terminal open failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("terminal open: %w", err)
	}

	t.mu.Lock()
	if len(t.ptys) >= t.maxSize {
		t.evictLRU()
	}
	t.ptys[terminalID] = pty
	t.connIDs[terminalID] = connID
	t.lastUsed[terminalID] = time.Now()
	t.mu.Unlock()
	pty.SetReadCallback(func(data []byte) { t.handlePTYOutput(terminalID, data) })
	exitReady := make(chan struct{})
	pty.SetExitCallback(func(err error) {
		<-exitReady
		t.handlePTYExit(terminalID, pty, err)
	})
	pty.Start()
	t.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{TerminalID: terminalID, State: "connected"})
	close(exitReady)

	t.logger.Info("terminal opened", "terminalID", terminalID)
	return terminalID, nil
}

func (t *TerminalService) handlePTYExit(terminalID string, exitedPTY *ssh.PTYSession, exitErr error) {
	t.mu.Lock()
	currentPTY, ok := t.ptys[terminalID]
	if !ok || currentPTY != exitedPTY {
		t.mu.Unlock()
		return
	}
	t.outputMu.Lock()
	delete(t.ptys, terminalID)
	delete(t.lastUsed, terminalID)
	if t.attached[terminalID] {
		delete(t.attached, terminalID)
		delete(t.pendingOutput, terminalID)
	}
	connID := t.connIDs[terminalID]
	delete(t.connIDs, terminalID)
	closeHandler := t.closeHandler
	expirePending := !t.attached[terminalID] && len(t.pendingOutput[terminalID]) > 0
	t.mu.Unlock()

	if closeHandler != nil {
		closeHandler(terminalID)
	}
	if t.sessionSvc != nil && connID != "" {
		if err := t.sessionSvc.disconnect(connID, false); err != nil {
			t.logger.Debug("remote terminal connection cleanup failed", "terminalID", terminalID, "error", err)
		}
	}
	t.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{
		TerminalID: terminalID,
		State:      "disconnected",
	})
	t.outputMu.Unlock()
	if expirePending {
		time.AfterFunc(pendingOutputTTL, func() { t.expirePendingOutput(terminalID) })
	}
	t.logger.Info("terminal disconnected by remote", "terminalID", terminalID, "error", exitErr)
}

func (t *TerminalService) Write(terminalID string, data string) (int, error) {
	t.logger.Debug("writing to terminal", "terminalID", terminalID, "len", len(data))
	t.mu.RLock()
	pty, ok := t.ptys[terminalID]
	t.mu.RUnlock()
	if !ok {
		return 0, fmt.Errorf("terminal %s not found", terminalID)
	}

	t.mu.Lock()
	t.lastUsed[terminalID] = time.Now()
	t.mu.Unlock()

	return pty.Write([]byte(data))
}

func (t *TerminalService) Resize(terminalID string, cols, rows int) error {
	t.logger.Info("resizing terminal", "terminalID", terminalID, "cols", cols, "rows", rows)
	t.mu.RLock()
	pty, ok := t.ptys[terminalID]
	t.mu.RUnlock()
	if !ok {
		return fmt.Errorf("terminal %s not found", terminalID)
	}

	t.mu.Lock()
	t.lastUsed[terminalID] = time.Now()
	t.mu.Unlock()

	return pty.Resize(cols, rows)
}

func (t *TerminalService) Close(terminalID string) error {
	t.logger.Info("closing terminal", "terminalID", terminalID)
	t.mu.Lock()
	pty, ok := t.ptys[terminalID]
	if !ok {
		if _, buffered := t.pendingOutput[terminalID]; buffered {
			t.outputMu.Lock()
			delete(t.pendingOutput, terminalID)
			delete(t.attached, terminalID)
			t.mu.Unlock()
			t.eventBus.Emit(event.TerminalClosed, event.ConnectionStatePayload{TerminalID: terminalID, State: "closed"})
			t.outputMu.Unlock()
			return nil
		}
		t.mu.Unlock()
		t.logger.Error("close terminal failed", "terminalID", terminalID, "error", "terminal not found")
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	t.outputMu.Lock()
	delete(t.ptys, terminalID)
	delete(t.lastUsed, terminalID)
	delete(t.attached, terminalID)
	delete(t.pendingOutput, terminalID)
	connID := t.connIDs[terminalID]
	delete(t.connIDs, terminalID)
	closeHandler := t.closeHandler
	t.mu.Unlock()

	if pty != nil {
		_ = pty.Close()
	}

	if closeHandler != nil {
		closeHandler(terminalID)
	}
	if t.sessionSvc != nil {
		if connID == "" {
			connID = terminalID
		}
		_ = t.sessionSvc.disconnect(connID, false)
	}

	t.eventBus.Emit(event.TerminalClosed, event.ConnectionStatePayload{
		TerminalID: terminalID,
		State:      "closed",
	})
	t.outputMu.Unlock()

	t.logger.Info("terminal closed", "terminalID", terminalID)
	return nil
}

func (t *TerminalService) Count() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.ptys)
}

func (t *TerminalService) SetMaxSize(maxSize int) error {
	if maxSize <= 0 {
		return fmt.Errorf("max terminal pool size must be greater than zero")
	}
	t.mu.Lock()
	t.maxSize = maxSize
	t.mu.Unlock()
	return nil
}
