package service

import (
	"errors"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
)

func TestTerminalServiceSystemInfoCoalescesConcurrentSampling(t *testing.T) {
	originalCommand := _runSystemInfoCommand
	originalProbe := _openSystemProbeConnection
	t.Cleanup(func() {
		_runSystemInfoCommand = originalCommand
		_openSystemProbeConnection = originalProbe
	})
	var calls atomic.Int32
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) {
		calls.Add(1)
		select {
		case started <- struct{}{}:
		default:
		}
		<-release
		return []byte("SCHEMA 1 SOURCE test SAMPLE 1 1 CPU 100 20 IOWAIT 0 MEMTOTAL 100 MEMAVAILABLE 50 SWAPTOTAL 0 SWAPFREE 0 NETIF eth0 1 2 DISKMOUNT /dev/sda1 / 1 2 1 CPUCOUNT 1 LOAD 1 1 1 UPTIME 10 KERNEL test OS test CAP cpu_delta"), nil
	}
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return &ssh.ClientWrapper{}, func() {}, nil
	}
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	service.sessionIDs["term-1"] = 1

	var waitGroup sync.WaitGroup
	waitGroup.Add(2)
	errors := make(chan error, 2)
	for range 2 {
		go func() {
			defer waitGroup.Done()
			_, err := service.SystemInfo("term-1")
			errors <- err
		}()
	}
	<-started
	time.Sleep(20 * time.Millisecond)
	close(release)
	waitGroup.Wait()
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}
	assert.Equal(t, int32(1), calls.Load())
}

func TestSystemInfoCommandProducesParsableOutput(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("system information probe requires Linux procfs")
	}
	output, err := exec.Command("sh", "-c", systemInfoCommand).CombinedOutput()
	require.NoError(t, err)
	info, _, err := parseSystemInfo(strings.Fields(string(output)))
	require.NoError(t, err)
	require.Equal(t, model.SystemInfoSchemaVersion, info.SchemaVersion)
	require.NotEmpty(t, info.Source)
	require.NotEmpty(t, info.Capabilities)
	require.Positive(t, info.CPUCount)
	require.NotEmpty(t, info.OSName)
}

func TestParseSystemInfo(t *testing.T) {
	info, sample, err := parseSystemInfo([]string{
		"SCHEMA", "1", "SOURCE", "linux-procfs", "SAMPLE", "1700000000000", "123000",
		"CPU", "100", "20", "IOWAIT", "5", "MEMTOTAL", "8589934592", "MEMAVAILABLE", "4294967296",
		"NETIF", "eth0", "1024", "2048", "NETIF", "lo", "10", "20",
		"DISKMOUNT", "/dev/sda1", "/", "107374182400", "536870912000", "400000000000", "CPUCOUNT", "4",
	})
	require.NoError(t, err)
	require.Equal(t, 1, info.SchemaVersion)
	require.Equal(t, "linux-procfs", info.Source)
	require.Equal(t, int64(1700000000000), info.SampledAtUnixMS)
	require.Equal(t, uint64(123000), info.SampledMonotonicMS)
	require.Equal(t, 4, info.CPUCount)
	require.Equal(t, uint64(8589934592), info.MemoryTotal)
	require.Equal(t, uint64(4294967296), info.MemoryUsed)
	require.Equal(t, uint64(107374182400), info.DiskUsed)
	require.Equal(t, uint64(536870912000), info.DiskTotal)
	require.Equal(t, uint64(1034), sample.received)
	require.Equal(t, uint64(2068), sample.transmitted)
	require.Equal(t, uint64(5), sample.iowait)
	require.Len(t, info.Interfaces, 2)
	require.Equal(t, "eth0", info.Interfaces[0].Name)
	require.False(t, info.Interfaces[0].Virtual)
	require.Equal(t, "lo", info.Interfaces[1].Name)
	require.True(t, info.Interfaces[1].Virtual)
	require.Len(t, info.DiskMounts, 1)
	require.Equal(t, "/", info.DiskMounts[0].MountPoint)
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
	runExited := make(chan struct{})
	runErr := errors.New("probe runner stopped")
	cancelErr := errors.New("probe cancel failed")
	result := make(chan error, 1)
	go func() {
		_, err := waitSystemProbe(func() ([]byte, error) {
			defer close(runExited)
			<-release
			return nil, runErr
		}, func() error {
			close(cancelled)
			return cancelErr
		})
		result <- err
	}()
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("probe session was not cancelled")
	}
	var err error
	returnedEarly := false
	select {
	case err = <-result:
		returnedEarly = true
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if !returnedEarly {
		err = <-result
	}
	<-runExited
	require.False(t, returnedEarly, "probe wait returned before the cancelled runner exited")
	require.ErrorContains(t, err, "probe timeout")
	require.ErrorIs(t, err, cancelErr)
	require.ErrorIs(t, err, runErr)
}

func TestWaitSystemProbeReturnsCommandResult(t *testing.T) {
	output, err := waitSystemProbe(func() ([]byte, error) { return []byte("ok"), nil }, func() error { return nil })
	require.NoError(t, err)
	require.Equal(t, []byte("ok"), output)
}

func TestWaitSystemProbeReturnsWhenCancellationCannotStopRunner(t *testing.T) {
	original := systemProbeTimeout
	originalAbortWait := systemProbeAbortWait
	systemProbeTimeout = 10 * time.Millisecond
	systemProbeAbortWait = 20 * time.Millisecond
	t.Cleanup(func() {
		systemProbeTimeout = original
		systemProbeAbortWait = originalAbortWait
	})
	release := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		_, err := waitSystemProbe(func() ([]byte, error) {
			<-release
			return nil, errors.New("late probe exit")
		}, func() error { return nil })
		result <- err
	}()

	select {
	case err := <-result:
		require.ErrorContains(t, err, "probe runner did not stop")
	case <-time.After(300 * time.Millisecond):
		close(release)
		<-result
		t.Fatal("probe timeout remained blocked after cancellation returned")
	}
	close(release)
}

func TestWaitSystemProbeReturnsWhenCancellationItselfBlocks(t *testing.T) {
	original := systemProbeTimeout
	originalAbortWait := systemProbeAbortWait
	systemProbeTimeout = 10 * time.Millisecond
	systemProbeAbortWait = 20 * time.Millisecond
	t.Cleanup(func() {
		systemProbeTimeout = original
		systemProbeAbortWait = originalAbortWait
	})
	releaseRun := make(chan struct{})
	releaseCancel := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		_, err := waitSystemProbe(func() ([]byte, error) {
			<-releaseRun
			return nil, nil
		}, func() error {
			<-releaseCancel
			return nil
		})
		result <- err
	}()

	select {
	case err := <-result:
		require.ErrorContains(t, err, "probe cancellation did not finish")
		require.ErrorContains(t, err, "probe runner did not stop")
	case <-time.After(300 * time.Millisecond):
		close(releaseCancel)
		close(releaseRun)
		<-result
		t.Fatal("probe timeout remained blocked in cancellation")
	}
	close(releaseCancel)
	close(releaseRun)
}

func TestCPUPercent(t *testing.T) {
	previous := systemSample{total: 100, idle: 40}
	current := systemSample{total: 200, idle: 80}
	require.Equal(t, 60.0, cpuPercent(previous, current))
	require.Equal(t, 50.0, cpuPercent(systemSample{total: 100, idle: 40, iowait: 10}, systemSample{total: 200, idle: 80, iowait: 20}))
	require.Zero(t, cpuPercent(systemSample{total: 1, idle: 1}, systemSample{total: 1, idle: 1}))
	require.Zero(t, cpuPercent(systemSample{total: 200, idle: 80}, systemSample{total: 100, idle: 40}))
	require.Zero(t, cpuPercent(systemSample{total: 100, idle: 20}, systemSample{total: 110, idle: 40}))
	require.Zero(t, cpuPercent(systemSample{total: 100, idle: 20, iowait: 10}, systemSample{total: 110, idle: 20, iowait: 5}))
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
	originalCommand := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = originalCommand })
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) {
		return []byte("CPU 200 80 MEMTOTAL 8589934592 MEMAVAILABLE 4294967296 NET 2048 4096 DISK 107374182400 536870912000 CPUCOUNT 4"), nil
	}
	originalProbe := _openSystemProbeConnection
	t.Cleanup(func() { _openSystemProbeConnection = originalProbe })
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return &ssh.ClientWrapper{}, func() {}, nil
	}
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	service.sessionIDs["term-1"] = 1
	service.systemMu.Lock()
	service.systemSamples["term-1"] = systemSample{total: 100, idle: 40, received: 1024, transmitted: 2048, at: time.Now().Add(-time.Second)}
	service.systemMu.Unlock()

	info, err := service.SystemInfo("term-1")
	require.NoError(t, err)
	require.Equal(t, 60.0, info.CPUPercent)
	require.Greater(t, info.DownloadRate, uint64(0))
	require.Greater(t, info.UploadRate, uint64(0))
}

func TestTerminalServiceSystemInfoErrors(t *testing.T) {
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	_, err := service.SystemInfo("missing")
	require.ErrorContains(t, err, "terminal missing not found")

	originalProbe := _openSystemProbeConnection
	t.Cleanup(func() { _openSystemProbeConnection = originalProbe })
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return nil, nil, errors.New("probe connection failed")
	}
	service.sessionIDs["term-1"] = 1
	_, err = service.SystemInfo("term-1")
	require.ErrorContains(t, err, "probe connection failed")

	originalCommand := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = originalCommand })
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return &ssh.ClientWrapper{}, func() {}, nil
	}
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) { return nil, errors.New("probe failed") }
	_, err = service.SystemInfo("term-1")
	require.ErrorContains(t, err, "probe failed")
}

func TestTerminalServiceProcessInfo(t *testing.T) {
	originalCommand := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = originalCommand })
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) {
		return []byte("10 1 root S 9.5 1024 tmux server\ninvalid row\n11 1 dev R bad 2048 vim"), nil
	}
	originalProbe := _openSystemProbeConnection
	t.Cleanup(func() { _openSystemProbeConnection = originalProbe })
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return &ssh.ClientWrapper{}, func() {}, nil
	}
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	service.sessionIDs["term-1"] = 1

	processes, err := service.ProcessInfo("term-1")
	require.NoError(t, err)
	require.Equal(t, []model.ProcessInfo{{PID: 10, PPID: 1, User: "root", State: "S", CPUPercent: 9.5, RSSBytes: 1024 * 1024, MemoryBytes: 1024 * 1024, Command: "tmux server", CPUSource: processCPUSourcePS}}, processes)
}

func TestTerminalServiceProcessInfoErrors(t *testing.T) {
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	_, err := service.ProcessInfo("missing")
	require.ErrorContains(t, err, "terminal missing not found")

	originalProbe := _openSystemProbeConnection
	t.Cleanup(func() { _openSystemProbeConnection = originalProbe })
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return nil, nil, errors.New("probe connection failed")
	}
	service.sessionIDs["term-1"] = 1
	_, err = service.ProcessInfo("term-1")
	require.ErrorContains(t, err, "probe connection failed")

	originalCommand := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = originalCommand })
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return &ssh.ClientWrapper{}, func() {}, nil
	}
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) { return nil, errors.New("process probe failed") }
	_, err = service.ProcessInfo("term-1")
	require.ErrorContains(t, err, "process probe failed")
}

func TestSystemInfoRejectsEmptyTerminalID(t *testing.T) {
	svc := &TerminalService{logger: testutil.NewTestLogger(), connIDs: map[string]string{}}
	_, err := svc.SystemInfo("")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid terminal id")
}

func TestProcessInfoRejectsEmptyTerminalID(t *testing.T) {
	svc := &TerminalService{logger: testutil.NewTestLogger(), connIDs: map[string]string{}}
	_, err := svc.ProcessInfo("")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid terminal id")
}
