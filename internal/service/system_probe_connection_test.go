package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
)

type probeSeamCounters struct {
	opens       atomic.Int32
	disconnects atomic.Int32
}

func stubProbeConnection(t *testing.T, counters *probeSeamCounters) {
	t.Helper()
	previous := _openSystemProbeConnection
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		counters.opens.Add(1)
		return &ssh.ClientWrapper{}, func() { counters.disconnects.Add(1) }, nil
	}
	t.Cleanup(func() { _openSystemProbeConnection = previous })
}

func TestAcquireSystemProbeConnectionReusesWhileTerminalOpen(t *testing.T) {
	var counters probeSeamCounters
	stubProbeConnection(t, &counters)
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 4, testutil.NewTestLogger())
	service.addProbeTerminalRef(1)

	first, releaseFirst, err := service.acquireSystemProbeConnection(1)
	require.NoError(t, err)
	second, releaseSecond, err := service.acquireSystemProbeConnection(1)
	require.NoError(t, err)
	require.Same(t, first, second)
	require.Equal(t, int32(1), counters.opens.Load())

	releaseFirst()
	releaseSecond()
	require.Equal(t, int32(0), counters.disconnects.Load())

	service.releaseProbeTerminalRef(1)
	require.Equal(t, int32(1), counters.disconnects.Load())

	_, releaseAgain, err := service.acquireSystemProbeConnection(1)
	require.NoError(t, err)
	require.Equal(t, int32(2), counters.opens.Load())
	releaseAgain()
	require.Equal(t, int32(2), counters.disconnects.Load())
}

func TestAcquireSystemProbeConnectionClosesWithoutTerminalRef(t *testing.T) {
	var counters probeSeamCounters
	stubProbeConnection(t, &counters)
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 4, testutil.NewTestLogger())

	wrapper, release, err := service.acquireSystemProbeConnection(1)
	require.NoError(t, err)
	require.NotNil(t, wrapper)
	require.Equal(t, int32(1), counters.opens.Load())
	require.Equal(t, int32(0), counters.disconnects.Load())

	release()
	require.Equal(t, int32(1), counters.disconnects.Load())
}

func TestAcquireSystemProbeConnectionInvalidSession(t *testing.T) {
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 4, testutil.NewTestLogger())
	_, _, err := service.acquireSystemProbeConnection(0)
	require.ErrorContains(t, err, "invalid session id")

	missingService := NewTerminalService(nil, newMockEventBus(), 4, testutil.NewTestLogger())
	_, _, err = missingService.acquireSystemProbeConnection(1)
	require.ErrorContains(t, err, "session service unavailable")
}

func TestCloseAllSystemProbeConnectionsDisconnects(t *testing.T) {
	var counters probeSeamCounters
	stubProbeConnection(t, &counters)
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 4, testutil.NewTestLogger())
	service.addProbeTerminalRef(1)
	_, release, err := service.acquireSystemProbeConnection(1)
	require.NoError(t, err)
	require.Equal(t, int32(1), counters.opens.Load())

	service.closeAllSystemProbeConnections()
	require.Equal(t, int32(1), counters.disconnects.Load())

	release()
	require.Equal(t, int32(1), counters.disconnects.Load())
}

func TestProbeConnectionStaysWhileProbeInFlight(t *testing.T) {
	var counters probeSeamCounters
	stubProbeConnection(t, &counters)
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 4, testutil.NewTestLogger())
	service.addProbeTerminalRef(1)
	wrapper, release, err := service.acquireSystemProbeConnection(1)
	require.NoError(t, err)
	require.NotNil(t, wrapper)

	service.releaseProbeTerminalRef(1)
	require.Equal(t, int32(0), counters.disconnects.Load())

	release()
	require.Equal(t, int32(1), counters.disconnects.Load())
}

func TestProbeTerminalRefsIgnoresNonPositiveSessions(t *testing.T) {
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 4, testutil.NewTestLogger())
	service.addProbeTerminalRef(0)
	service.addProbeTerminalRef(-1)
	service.releaseProbeTerminalRef(0)
	service.releaseProbeTerminalRef(-1)
	service.probeMu.Lock()
	defer service.probeMu.Unlock()
	require.Len(t, service.probeTerminalRefs, 0)
}

func TestSystemInfoUsesDedicatedProbeConnection(t *testing.T) {
	sessionSvc, service, created, cleanup := newDirectoryIntegrationTestHarness(t, false)
	defer cleanup()

	terminalID, err := service.Open(context.Background(), created.ID, 80, 24)
	require.NoError(t, err)
	terminalConnID := service.connIDs[terminalID]
	terminalWrapper, err := sessionSvc.GetClientWrapper(terminalConnID)
	require.NoError(t, err)
	terminalAddr := terminalWrapper.Inner.LocalAddr().String()
	require.Equal(t, 1, sessionSvc.ConnectionCount())

	original := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = original })
	probeAddr := make(chan string, 1)
	_runSystemInfoCommand = func(wrapper *ssh.ClientWrapper, _ string) ([]byte, error) {
		probeAddr <- wrapper.Inner.LocalAddr().String()
		return []byte("CPU 200 80 MEMTOTAL 8589934592 MEMAVAILABLE 4294967296 NET 2048 4096 DISK 107374182400 536870912000 CPUCOUNT 4"), nil
	}

	info, err := service.SystemInfo(terminalID)
	require.NoError(t, err)
	require.Equal(t, 4, info.CPUCount)
	require.NotEqual(t, terminalAddr, <-probeAddr)
	require.Equal(t, 2, sessionSvc.ConnectionCount())

	require.NoError(t, service.Close(terminalID))
	require.Equal(t, 0, sessionSvc.ConnectionCount())
}

func TestSystemInfoProbeIgnoresMalformedKnownHostsLine(t *testing.T) {
	sessionSvc, service, created, cleanup := newDirectoryIntegrationTestHarness(t, false)
	defer cleanup()

	terminalID, err := service.Open(context.Background(), created.ID, 80, 24)
	require.NoError(t, err)
	knownHostsPath := filepath.Join(sessionSvc.dataDir, "known_hosts")
	file, err := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_WRONLY, 0o600)
	require.NoError(t, err)
	_, writeErr := file.WriteString("broken ssh-ed25519 illegal-base64\n")
	closeErr := file.Close()
	require.NoError(t, errors.Join(writeErr, closeErr))

	original := _runSystemInfoCommand
	t.Cleanup(func() { _runSystemInfoCommand = original })
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) {
		return []byte("CPU 200 80 MEMTOTAL 8589934592 MEMAVAILABLE 4294967296 NET 2048 4096 DISK 107374182400 536870912000 CPUCOUNT 4"), nil
	}

	info, err := service.SystemInfo(terminalID)
	require.NoError(t, err)
	require.Equal(t, 4, info.CPUCount)
}
