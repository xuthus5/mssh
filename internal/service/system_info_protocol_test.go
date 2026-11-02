package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

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

func TestParseSystemInfoRejectsUnsupportedSchema(t *testing.T) {
	_, _, err := parseSystemInfo([]string{"SCHEMA", "2", "SOURCE", "portable"})
	require.ErrorContains(t, err, "invalid system info field SCHEMA")
}

func TestParseSystemInfoRejectsMalformedTopology(t *testing.T) {
	for _, values := range [][]string{{"NETIF", "eth0", "1"}, {"DISKMOUNT", "/dev/sda1", "/", "1", "2"}} {
		require.Equal(t, -1, parseSystemInfoField(&model.SystemInfo{}, &systemSample{interfaces: map[string]networkCounter{}}, values))
	}
	_, _, err := parseSystemInfo([]string{"SCHEMA", "1", "SOURCE", "linux-procfs", "NETIF", "eth0", "1"})
	require.ErrorContains(t, err, "invalid system info field NETIF")
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

func TestApplyInterfaceRatesFallsBackToNonLoopback(t *testing.T) {
	info := &model.SystemInfo{Interfaces: []model.NetworkInterface{{Name: "tun0", Virtual: true, ReceivedBytes: 100}, {Name: "lo", Virtual: true, ReceivedBytes: 999}}}
	previous := systemSample{interfaces: map[string]networkCounter{"tun0": {received: 50}, "lo": {received: 500}}}
	applyInterfaceRates(info, previous, 1)
	assert.Equal(t, uint64(50), info.DownloadRate)
	assert.Zero(t, info.UploadRate)
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
	}
	service.deleteSystemSample("term-1")
	assert.Empty(t, service.systemSamples)
	assert.Empty(t, service.systemProcessSamples)
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
