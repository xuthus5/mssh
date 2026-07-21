package service

import (
	"errors"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
)

func TestSystemInfoCommandProducesParsableOutput(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("system information probe requires Linux procfs")
	}
	output, err := exec.Command("sh", "-c", systemInfoCommand).Output()
	require.NoError(t, err)
	info, _, err := parseSystemInfo(strings.Fields(string(output)))
	require.NoError(t, err)
	require.Positive(t, info.CPUCount)
	require.NotEmpty(t, info.OSName)
}

func TestParseSystemInfo(t *testing.T) {
	info, sample, err := parseSystemInfo([]string{
		"CPU", "100", "20", "MEMTOTAL", "8589934592", "MEMAVAILABLE", "4294967296",
		"NET", "1024", "2048", "DISK", "107374182400", "536870912000", "CPUCOUNT", "4",
	})
	require.NoError(t, err)
	require.Equal(t, 4, info.CPUCount)
	require.Equal(t, uint64(8589934592), info.MemoryTotal)
	require.Equal(t, uint64(4294967296), info.MemoryUsed)
	require.Equal(t, uint64(107374182400), info.DiskUsed)
	require.Equal(t, uint64(536870912000), info.DiskTotal)
	require.Equal(t, uint64(1024), sample.received)
	require.Equal(t, uint64(2048), sample.transmitted)
}

func TestParseSystemInfoPreservesMultiWordOSName(t *testing.T) {
	info, _, err := parseSystemInfo([]string{
		"OS", "A", "B", "C", "CPU", "100", "20", "MEMTOTAL", "8589934592",
		"MEMAVAILABLE", "4294967296", "NET", "1024", "2048", "DISK", "1", "2", "CPUCOUNT", "4",
	})
	require.NoError(t, err)
	require.Equal(t, "A B C", info.OSName)
	require.Equal(t, 4, info.CPUCount)
}

func TestParseSystemInfoRejectsUnknownField(t *testing.T) {
	_, _, err := parseSystemInfo([]string{
		"CPU", "100", "20", "MEMTOTAL", "10", "MEMAVAILABLE", "5",
		"NET", "1", "2", "DISK", "1", "2", "UNKNOWN", "4",
	})
	require.ErrorContains(t, err, "unknown system info field")
}

func TestParseSystemInfoRejectsInvalidNumericValue(t *testing.T) {
	_, _, err := parseSystemInfo([]string{
		"CPU", "invalid", "20", "MEMTOTAL", "10", "MEMAVAILABLE", "5",
		"NET", "1", "2", "DISK", "1", "2", "CPUCOUNT", "4",
	})
	require.ErrorContains(t, err, "invalid system info field CPU")
}

func TestParseSystemInfoRejectsIncompleteResponse(t *testing.T) {
	_, _, err := parseSystemInfo([]string{"CPU", "1"})
	require.ErrorContains(t, err, "invalid system info response")
}

func TestParseSystemInfoRejectsTruncatedStructuredField(t *testing.T) {
	values := []string{"CPU", "100", "20", "MEMTOTAL", "10", "MEMAVAILABLE", "5", "NET", "1", "2", "DISK", "1", "2", "CPUCOUNT", "4", "LOAD", "1"}
	_, _, err := parseSystemInfo(values)
	require.ErrorContains(t, err, "invalid system info field")
}

func TestParseSystemInfoFieldRejectsInvalidDetails(t *testing.T) {
	tests := []struct {
		name   string
		values []string
		result *model.SystemInfo
	}{
		{name: "missing value", values: []string{"CPU"}, result: &model.SystemInfo{}},
		{name: "invalid memory", values: []string{"MEMTOTAL", "invalid"}, result: &model.SystemInfo{}},
		{name: "available exceeds total", values: []string{"MEMAVAILABLE", "10"}, result: &model.SystemInfo{MemoryTotal: 5}},
		{name: "invalid uptime", values: []string{"UPTIME", "invalid"}, result: &model.SystemInfo{}},
		{name: "invalid cpu count", values: []string{"CPUCOUNT", "0"}, result: &model.SystemInfo{}},
		{name: "missing os value", values: []string{"OS", "CPU"}, result: &model.SystemInfo{}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.LessOrEqual(t, parseSystemInfoField(test.result, &systemSample{}, test.values), 0)
		})
	}
}

func TestParseWideSystemInfoFieldRejectsTruncatedValues(t *testing.T) {
	uint := func(string) uint64 { return 0 }
	float := func(string) float64 { return 0 }
	for _, values := range [][]string{{"CPU", "1"}, {"NET", "1"}, {"DISK", "1"}, {"LOAD", "1"}} {
		require.Equal(t, -1, parseWideSystemInfoField(&model.SystemInfo{}, &systemSample{}, values, uint, float))
	}
}

func TestWaitSystemProbeTimesOutAndCancels(t *testing.T) {
	original := systemProbeTimeout
	systemProbeTimeout = 10 * time.Millisecond
	t.Cleanup(func() { systemProbeTimeout = original })
	cancelled := make(chan struct{})
	release := make(chan struct{})
	_, err := waitSystemProbe(func() ([]byte, error) { <-release; return nil, nil }, func() error { close(cancelled); close(release); return nil })
	require.ErrorContains(t, err, "probe timeout")
	select {
	case <-cancelled:
	default:
		t.Fatal("probe session was not cancelled")
	}
}

func TestWaitSystemProbeReturnsCommandResult(t *testing.T) {
	output, err := waitSystemProbe(func() ([]byte, error) { return []byte("ok"), nil }, func() error { return nil })
	require.NoError(t, err)
	require.Equal(t, []byte("ok"), output)
}

func TestCPUPercent(t *testing.T) {
	previous := systemSample{total: 100, idle: 40}
	current := systemSample{total: 200, idle: 80}
	require.Equal(t, 60.0, cpuPercent(previous, current))
	require.Zero(t, cpuPercent(systemSample{total: 1, idle: 1}, systemSample{total: 1, idle: 1}))
	require.Zero(t, cpuPercent(systemSample{total: 200, idle: 80}, systemSample{total: 100, idle: 40}))
	require.Zero(t, cpuPercent(systemSample{total: 100, idle: 20}, systemSample{total: 110, idle: 40}))
}

func TestByteRate(t *testing.T) {
	require.Equal(t, uint64(512), byteRate(1024, 2048, 2))
	require.Zero(t, byteRate(2048, 1024, 1))
	require.Zero(t, byteRate(1024, 2048, 0))
}

func TestUpdateSystemRatesHandlesInitialAndInvalidIntervals(t *testing.T) {
	service := &TerminalService{systemSamples: make(map[string]systemSample)}
	info := &model.SystemInfo{}
	now := time.Now()
	service.updateSystemRates("term-1", info, systemSample{total: 100, idle: 40}, now)
	require.Zero(t, info.CPUPercent)
	service.updateSystemRates("term-1", info, systemSample{total: 200, idle: 80}, now)
	require.Zero(t, info.CPUPercent)
}

func TestTerminalServiceSystemInfo(t *testing.T) {
	original := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = original })
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) {
		return []byte("CPU 200 80 MEMTOTAL 8589934592 MEMAVAILABLE 4294967296 NET 2048 4096 DISK 107374182400 536870912000 CPUCOUNT 4"), nil
	}
	sessionService := &SessionService{conns: map[string]*managedConn{"conn-1": {wrapper: &ssh.ClientWrapper{}}}}
	service := NewTerminalService(sessionService, newMockEventBus(), 2, testutil.NewTestLogger())
	service.connIDs["term-1"] = "conn-1"
	service.systemSamples["term-1"] = systemSample{total: 100, idle: 40, received: 1024, transmitted: 2048, at: time.Now().Add(-time.Second)}

	info, err := service.SystemInfo("term-1")
	require.NoError(t, err)
	require.Equal(t, 60.0, info.CPUPercent)
	require.Greater(t, info.DownloadRate, uint64(0))
	require.Greater(t, info.UploadRate, uint64(0))
}

func TestTerminalServiceSystemInfoErrors(t *testing.T) {
	service := NewTerminalService(&SessionService{conns: map[string]*managedConn{}}, newMockEventBus(), 2, testutil.NewTestLogger())
	_, err := service.SystemInfo("missing")
	require.ErrorContains(t, err, "terminal missing not found")

	service.connIDs["term-1"] = "missing"
	_, err = service.SystemInfo("term-1")
	require.ErrorContains(t, err, "connection missing not found")

	original := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = original })
	service.sessionSvc.conns["conn-1"] = &managedConn{wrapper: &ssh.ClientWrapper{}}
	service.connIDs["term-1"] = "conn-1"
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) { return nil, errors.New("probe failed") }
	_, err = service.SystemInfo("term-1")
	require.ErrorContains(t, err, "probe failed")
}

func TestTerminalServiceProcessInfo(t *testing.T) {
	original := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = original })
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) {
		return []byte("10 1 root S 9.5 1024 tmux server\ninvalid row\n11 1 dev R bad 2048 vim"), nil
	}
	service := NewTerminalService(&SessionService{conns: map[string]*managedConn{"conn-1": {wrapper: &ssh.ClientWrapper{}}}}, newMockEventBus(), 2, testutil.NewTestLogger())
	service.connIDs["term-1"] = "conn-1"

	processes, err := service.ProcessInfo("term-1")
	require.NoError(t, err)
	require.Equal(t, []model.ProcessInfo{{PID: 10, PPID: 1, User: "root", State: "S", CPUPercent: 9.5, RSSBytes: 1024 * 1024, MemoryBytes: 1024 * 1024, Command: "tmux server"}}, processes)
}

func TestTerminalServiceProcessInfoErrors(t *testing.T) {
	service := NewTerminalService(&SessionService{conns: map[string]*managedConn{}}, newMockEventBus(), 2, testutil.NewTestLogger())
	_, err := service.ProcessInfo("missing")
	require.ErrorContains(t, err, "terminal missing not found")

	original := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = original })
	service.sessionSvc.conns["conn-1"] = &managedConn{wrapper: &ssh.ClientWrapper{}}
	service.connIDs["term-1"] = "conn-1"
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) { return nil, errors.New("process probe failed") }
	_, err = service.ProcessInfo("term-1")
	require.ErrorContains(t, err, "process probe failed")
}
