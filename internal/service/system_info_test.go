package service

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
)

func TestParseSystemInfo(t *testing.T) {
	info, sample, err := parseSystemInfo([]string{
		"CPU", "100", "20", "MEMTOTAL", "8589934592", "MEMAVAILABLE", "4294967296",
		"NET", "1024", "2048", "DISK", "107374182400", "536870912000", "4",
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

func TestParseSystemInfoRejectsIncompleteResponse(t *testing.T) {
	_, _, err := parseSystemInfo([]string{"CPU", "1"})
	require.ErrorContains(t, err, "invalid system info response")
}

func TestCPUPercent(t *testing.T) {
	previous := systemSample{total: 100, idle: 40}
	current := systemSample{total: 200, idle: 80}
	require.Equal(t, 60.0, cpuPercent(previous, current))
	require.Zero(t, cpuPercent(systemSample{total: 1, idle: 1}, systemSample{total: 1, idle: 1}))
}

func TestTerminalServiceSystemInfo(t *testing.T) {
	original := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = original })
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) {
		return []byte("CPU 200 80 MEMTOTAL 8589934592 MEMAVAILABLE 4294967296 NET 2048 4096 DISK 107374182400 536870912000 4"), nil
	}
	sessionService := &SessionService{conns: map[string]*ssh.ClientWrapper{"conn-1": {}}}
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
	service := NewTerminalService(&SessionService{conns: map[string]*ssh.ClientWrapper{}}, newMockEventBus(), 2, testutil.NewTestLogger())
	_, err := service.SystemInfo("missing")
	require.ErrorContains(t, err, "terminal missing not found")

	service.connIDs["term-1"] = "missing"
	_, err = service.SystemInfo("term-1")
	require.ErrorContains(t, err, "connection missing not found")

	original := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = original })
	service.sessionSvc.conns["conn-1"] = &ssh.ClientWrapper{}
	service.connIDs["term-1"] = "conn-1"
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) { return nil, errors.New("probe failed") }
	_, err = service.SystemInfo("term-1")
	require.ErrorContains(t, err, "probe failed")
}
