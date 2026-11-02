package service

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestLoadSystemInfoSnapshotCoalescesConcurrentCalls(t *testing.T) {
	service := &TerminalService{systemInfoSnapshots: make(map[string]*systemInfoSnapshot)}
	previousTTL := systemInfoSnapshotTTL
	systemInfoSnapshotTTL = 0
	t.Cleanup(func() { systemInfoSnapshotTTL = previousTTL })

	var calls atomic.Int32
	release := make(chan struct{})
	results := make(chan *model.SystemInfo, 2)
	errors := make(chan error, 2)
	var ready sync.WaitGroup
	ready.Add(2)
	collect := func() (*model.SystemInfo, error) {
		calls.Add(1)
		<-release
		return &model.SystemInfo{CPUPercent: 42}, nil
	}
	for range 2 {
		go func() {
			ready.Done()
			info, err := service.loadSystemInfoSnapshot("term-1", collect)
			results <- info
			errors <- err
		}()
	}
	ready.Wait()
	require.Eventually(t, func() bool { return calls.Load() == 1 }, time.Second, time.Millisecond)
	close(release)

	first, second := <-results, <-results
	require.NoError(t, <-errors)
	require.NoError(t, <-errors)
	assert.Same(t, first, second)
	assert.Equal(t, int32(1), calls.Load())
}

func TestLoadSystemInfoSnapshotDoesNotCacheFailure(t *testing.T) {
	service := &TerminalService{systemInfoSnapshots: make(map[string]*systemInfoSnapshot)}
	var calls atomic.Int32
	collect := func() (*model.SystemInfo, error) {
		if calls.Add(1) == 1 {
			return nil, assert.AnError
		}
		return &model.SystemInfo{CPUPercent: 42}, nil
	}

	_, err := service.loadSystemInfoSnapshot("term-1", collect)
	require.ErrorIs(t, err, assert.AnError)
	info, err := service.loadSystemInfoSnapshot("term-1", collect)
	require.NoError(t, err)
	assert.Equal(t, 42.0, info.CPUPercent)
	assert.Equal(t, int32(2), calls.Load())
}

func TestLoadSystemInfoSnapshotReusesFreshResultUntilExpiry(t *testing.T) {
	service := &TerminalService{}
	previousTTL := systemInfoSnapshotTTL
	systemInfoSnapshotTTL = 20 * time.Millisecond
	t.Cleanup(func() { systemInfoSnapshotTTL = previousTTL })
	var calls atomic.Int32
	collect := func() (*model.SystemInfo, error) {
		return &model.SystemInfo{CPUPercent: float64(calls.Add(1))}, nil
	}

	first, err := service.loadSystemInfoSnapshot("term-1", collect)
	require.NoError(t, err)
	cached, err := service.loadSystemInfoSnapshot("term-1", collect)
	require.NoError(t, err)
	assert.Same(t, first, cached)
	assert.Equal(t, int32(1), calls.Load())

	time.Sleep(25 * time.Millisecond)
	fresh, err := service.loadSystemInfoSnapshot("term-1", collect)
	require.NoError(t, err)
	assert.NotSame(t, first, fresh)
	assert.Equal(t, 2.0, fresh.CPUPercent)
}

func TestLoadSystemInfoSnapshotToleratesEntryRemovedDuringCollection(t *testing.T) {
	service := &TerminalService{systemInfoSnapshots: make(map[string]*systemInfoSnapshot)}
	_, err := service.loadSystemInfoSnapshot("term-1", func() (*model.SystemInfo, error) {
		service.deleteSystemSample("term-1")
		return nil, assert.AnError
	})
	require.ErrorIs(t, err, assert.AnError)
	assert.Empty(t, service.systemInfoSnapshots)
}

func TestParseSystemInfoReportsUnavailableMetrics(t *testing.T) {
	info, _, err := parseSystemInfo([]string{"SCHEMA", "1", "SOURCE", "portable", "SAMPLE", "10", "0", "CPUCOUNT", "1"})
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{
		warningCPUUnavailable, warningMemoryUnavailable, warningSwapUnavailable,
		warningNetworkUnavailable, warningDiskUnavailable, warningLoadUnavailable, warningUptimeUnavailable,
	}, info.Warnings)
}

func TestParseSystemInfoWarningsAreUnique(t *testing.T) {
	info, _, err := parseSystemInfo([]string{
		"SCHEMA", "1", "SOURCE", "portable", "WARN", warningCPUUnavailable,
		"WARN", warningCPUUnavailable, "CPUCOUNT", "1",
	})
	require.NoError(t, err)
	assert.Equal(t, 1, countWarning(info.Warnings, warningCPUUnavailable))
}

func TestParseSystemInfoCapabilitiesAreUnique(t *testing.T) {
	info, _, err := parseSystemInfo([]string{
		"SCHEMA", "1", "SOURCE", "linux-procfs",
		"CAP", "cpu_delta", "network_roles", "CAP", "cpu_delta", "disk_mounts",
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"cpu_delta", "network_roles", "disk_mounts"}, info.Capabilities)
}

func TestParseSystemInfoRejectsEmptyCapabilities(t *testing.T) {
	_, _, err := parseSystemInfo([]string{"SCHEMA", "1", "SOURCE", "linux-procfs", "CAP"})
	require.ErrorContains(t, err, "invalid system info field CAP")
}

func TestParseSystemInfoRejectsUnsupportedSchema(t *testing.T) {
	_, _, err := parseSystemInfo([]string{"SCHEMA", "2", "SOURCE", "portable"})
	require.ErrorContains(t, err, "invalid system info field SCHEMA")
}

func TestParseSystemInfoRejectsMalformedTopology(t *testing.T) {
	for _, values := range [][]string{{"NETIF", "eth0", "1"}, {"NETROLE", "eth0"}, {"DISKMOUNT", "/dev/sda1", "/", "1", "2"}} {
		require.Equal(t, -1, parseSystemInfoField(&model.SystemInfo{}, &systemSample{interfaces: map[string]networkCounter{}}, values))
	}
	_, _, err := parseSystemInfo([]string{"SCHEMA", "1", "SOURCE", "linux-procfs", "NETIF", "eth0", "1"})
	require.ErrorContains(t, err, "invalid system info field NETIF")
}

func TestParseSystemInfoNetworkRoles(t *testing.T) {
	info, _, err := parseSystemInfo([]string{
		"SCHEMA", "1", "SOURCE", "linux-procfs",
		"NETROLE", "bond0", "bond", "NETIF", "bond0", "20", "10",
		"NETIF", "eth0", "10", "5", "NETROLE", "eth0", "slave",
	})
	require.NoError(t, err)
	require.Len(t, info.Interfaces, 2)
	assert.Equal(t, "bond0", info.Interfaces[0].Name)
	assert.Equal(t, networkRoleBond, info.Interfaces[0].Role)
	assert.Equal(t, "eth0", info.Interfaces[1].Name)
	assert.Equal(t, networkRoleSlave, info.Interfaces[1].Role)
}

func TestParseSystemInfoRejectsInvalidNetworkRole(t *testing.T) {
	_, _, err := parseSystemInfo([]string{"SCHEMA", "1", "SOURCE", "linux-procfs", "NETROLE", "eth0", "unknown"})
	require.ErrorContains(t, err, "invalid system info field NETROLE")
}

func TestParseSystemInfoRejectsInvalidStructuredMetadata(t *testing.T) {
	tests := [][]string{
		{"SCHEMA", "1", "SOURCE", ""},
		{"SCHEMA", "1", "SAMPLE", "invalid", "0"},
		{"SCHEMA", "1", "SAMPLE", "10"},
		{"SCHEMA", "1", "SWAPTOTAL", "10", "SWAPFREE", "20"},
		{"SCHEMA", "1", "UPTIME", "NaN"},
	}
	for _, values := range tests {
		_, _, err := parseSystemInfo(values)
		assert.Error(t, err, values)
	}
}

func TestSystemSampleElapsedUsesRemoteClockPrecedence(t *testing.T) {
	now := time.Now()
	assert.Equal(t, 2.0, systemSampleElapsed(
		systemSample{at: now.Add(-time.Hour), sampledAtMS: 1000, monotonicMS: 1000},
		systemSample{at: now, sampledAtMS: 5000, monotonicMS: 3000},
	))
	assert.Equal(t, 4.0, systemSampleElapsed(
		systemSample{at: now.Add(-time.Hour), sampledAtMS: 1000},
		systemSample{at: now, sampledAtMS: 5000},
	))
	assert.Equal(t, 2.0, systemSampleElapsed(systemSample{at: now.Add(-2 * time.Second)}, systemSample{at: now}))
	assert.Zero(t, systemSampleElapsed(systemSample{}, systemSample{}))
}

func TestUpdateSystemRatesUsesRemoteClockAndInterfaceCounters(t *testing.T) {
	service := &TerminalService{systemSamples: make(map[string]systemSample)}
	previous := systemSample{
		sampledAtMS: 1000, hasInterfaces: true,
		interfaces: map[string]networkCounter{"eth0": {received: 1000, transmitted: 2000}, "lo": {received: 10, transmitted: 20}},
	}
	service.updateSystemRates("term-1", &model.SystemInfo{}, previous, time.Now().Add(-time.Hour))
	info := &model.SystemInfo{Interfaces: []model.NetworkInterface{
		{Name: "eth0", ReceivedBytes: 3000, TransmittedBytes: 3000},
		{Name: "lo", ReceivedBytes: 50, TransmittedBytes: 60, Virtual: true},
	}}
	current := systemSample{
		sampledAtMS: 3000, hasInterfaces: true,
		interfaces: map[string]networkCounter{"eth0": {received: 3000, transmitted: 3000}, "lo": {received: 50, transmitted: 60}},
	}
	service.updateSystemRates("term-1", info, current, time.Now())
	assert.Equal(t, uint64(1000), info.DownloadRate)
	assert.Equal(t, uint64(500), info.UploadRate)
	assert.Equal(t, uint64(1000), info.Interfaces[0].DownloadRate)
	assert.Equal(t, uint64(500), info.Interfaces[0].UploadRate)
	assert.Equal(t, uint64(20), info.Interfaces[1].DownloadRate)
}

func TestUpdateSystemRatesTracksSamplingMetadata(t *testing.T) {
	service := &TerminalService{systemSamples: make(map[string]systemSample)}
	first := &model.SystemInfo{}
	service.updateSystemRates("term-1", first, systemSample{monotonicMS: 1000}, time.Now())
	assert.Equal(t, uint64(1), first.SampleSequence)
	assert.Zero(t, first.SampleIntervalMS)

	second := &model.SystemInfo{}
	service.updateSystemRates("term-1", second, systemSample{monotonicMS: 3500}, time.Now().Add(2*time.Second))
	assert.Equal(t, uint64(2), second.SampleSequence)
	assert.Equal(t, uint64(2500), second.SampleIntervalMS)
}

func TestApplyInterfaceRatesFallsBackToNonLoopback(t *testing.T) {
	info := &model.SystemInfo{Interfaces: []model.NetworkInterface{{Name: "tun0", Virtual: true, ReceivedBytes: 100}, {Name: "lo", Virtual: true, ReceivedBytes: 999}}}
	previous := systemSample{interfaces: map[string]networkCounter{"tun0": {received: 50}, "lo": {received: 500}}}
	applyInterfaceRates(info, previous, 1)
	assert.Equal(t, uint64(50), info.DownloadRate)
	assert.Zero(t, info.UploadRate)
}

func TestApplyInterfaceRatesExcludesBondSlaves(t *testing.T) {
	info := &model.SystemInfo{Interfaces: []model.NetworkInterface{
		{Name: "bond0", Role: networkRoleBond, ReceivedBytes: 2000, TransmittedBytes: 1000},
		{Name: "eth0", Role: networkRoleSlave, ReceivedBytes: 2000, TransmittedBytes: 1000},
	}}
	previous := systemSample{interfaces: map[string]networkCounter{
		"bond0": {received: 1000, transmitted: 500},
		"eth0":  {received: 1000, transmitted: 500},
	}}
	applyInterfaceRates(info, previous, 1)
	assert.Equal(t, uint64(1000), info.DownloadRate)
	assert.Equal(t, uint64(500), info.UploadRate)
}

func TestIsNetworkAggregateEndpoint(t *testing.T) {
	tests := []struct {
		name             string
		networkInterface model.NetworkInterface
		want             bool
	}{
		{name: "physical", networkInterface: model.NetworkInterface{Role: networkRolePhysical}, want: true},
		{name: "bond", networkInterface: model.NetworkInterface{Role: networkRoleBond, Virtual: true}, want: true},
		{name: "bridge", networkInterface: model.NetworkInterface{Role: networkRoleBridge, Virtual: true}, want: true},
		{name: "team", networkInterface: model.NetworkInterface{Role: networkRoleTeam}, want: true},
		{name: "slave", networkInterface: model.NetworkInterface{Role: networkRoleSlave}, want: false},
		{name: "loopback", networkInterface: model.NetworkInterface{Role: networkRoleLoopback}, want: false},
		{name: "virtual fallback", networkInterface: model.NetworkInterface{Virtual: true}, want: false},
		{name: "physical fallback", networkInterface: model.NetworkInterface{}, want: true},
	}
	for _, test := range tests {
		assert.Equal(t, test.want, isNetworkAggregateEndpoint(test.networkInterface), test.name)
	}
}

func TestValidNetworkRole(t *testing.T) {
	for _, role := range []string{networkRoleLoopback, networkRolePhysical, networkRoleBond, networkRoleBridge, networkRoleTeam, networkRoleSlave} {
		assert.True(t, validNetworkRole(role), role)
	}
	assert.False(t, validNetworkRole("unknown"))
}

func TestApplyDiskMountSummary(t *testing.T) {
	root := &model.SystemInfo{DiskUsed: 1, DiskTotal: 2, DiskMounts: []model.DiskMount{
		{MountPoint: "/data", UsedBytes: 10, TotalBytes: 20}, {MountPoint: "/", UsedBytes: 30, TotalBytes: 40},
	}}
	applyDiskMountSummary(root)
	assert.Equal(t, uint64(30), root.DiskUsed)
	assert.Equal(t, uint64(40), root.DiskTotal)

	fallback := &model.SystemInfo{DiskMounts: []model.DiskMount{{MountPoint: "/data", UsedBytes: 10, TotalBytes: 20}}}
	applyDiskMountSummary(fallback)
	assert.Equal(t, uint64(10), fallback.DiskUsed)
	assert.Equal(t, uint64(20), fallback.DiskTotal)

	empty := &model.SystemInfo{}
	applyDiskMountSummary(empty)
	assert.Zero(t, empty.DiskTotal)
}

func TestVirtualNetworkInterface(t *testing.T) {
	for _, name := range []string{"lo", "lo0", "veth123", "docker0", "br-123", "virbr0", "cni0", "flannel.1", "cali123", "vxlan0", "vnet0", "utun3", "awdl0", "llw0", "bridge0", "anpi0", "gif0", "stf0", "tunl0", "tun0", "tap0", "wg0"} {
		assert.True(t, isVirtualNetworkInterface(name), name)
	}
	for _, name := range []string{"eth0", "en0", "ens3", "bond0", "wlan0"} {
		assert.False(t, isVirtualNetworkInterface(name), name)
	}
}

func TestParseNumericFieldsRejectInvalidValues(t *testing.T) {
	valid := true
	_, err := parseUintField("-1", &valid)
	assert.Error(t, err)
	assert.False(t, valid)
	valid = true
	_, err = parseFloatField("Inf", &valid)
	assert.Error(t, err)
	assert.False(t, valid)
}

func TestParseDiskMountUnescapesSpaces(t *testing.T) {
	info, _, err := parseSystemInfo([]string{
		"SCHEMA", "1", "SOURCE", "linux-procfs", "DISKMOUNT", "/dev/sda1", `/mnt/data\040disk`, "10", "20", "10",
	})
	require.NoError(t, err)
	require.Len(t, info.DiskMounts, 1)
	assert.Equal(t, "/mnt/data disk", info.DiskMounts[0].MountPoint)
}

func TestCloneNetworkCounters(t *testing.T) {
	assert.Nil(t, cloneNetworkCounters(nil))
	source := map[string]networkCounter{"eth0": {received: 1, transmitted: 2}}
	cloned := cloneNetworkCounters(source)
	assert.Equal(t, source, cloned)
	cloned["eth0"] = networkCounter{received: 3}
	assert.Equal(t, uint64(1), source["eth0"].received)
}

func TestDeleteSystemSampleClearsProcessSamples(t *testing.T) {
	service := &TerminalService{
		systemSamples:        map[string]systemSample{"term-1": {}},
		systemProcessSamples: map[string]processSample{"term-1": {}},
		systemInfoSnapshots:  map[string]*systemInfoSnapshot{"term-1": {}},
	}
	service.deleteSystemSample("term-1")
	assert.Empty(t, service.systemSamples)
	assert.Empty(t, service.systemProcessSamples)
	assert.Empty(t, service.systemInfoSnapshots)
}

func countWarning(warnings []string, target string) int {
	count := 0
	for _, warning := range warnings {
		if warning == target {
			count++
		}
	}
	return count
}
