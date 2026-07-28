package service

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestSystemInfoCommandSupportsDarwinFixtures(t *testing.T) {
	output := runProbeCommandWithFixtures(t, systemInfoCommand, darwinProbeFixtures())

	info, sample, err := parseSystemInfo(strings.Fields(string(output)))
	require.NoError(t, err)
	assert.Equal(t, 30.0, info.CPUPercent)
	assert.Equal(t, 8, info.CPUCount)
	assert.Equal(t, uint64(16*1024*1024*1024), info.MemoryTotal)
	assert.Equal(t, uint64(16*1024*1024*1024-350*4096), info.MemoryUsed)
	assert.Equal(t, uint64(400*1024), info.DiskUsed)
	assert.Equal(t, uint64(1000*1024), info.DiskTotal)
	assert.Equal(t, uint64(512*1024*1024), info.SwapUsed)
	assert.Equal(t, "macOS 15.0", info.OSName)
	assert.Equal(t, "23.6.0", info.KernelVersion)
	assert.Positive(t, info.UptimeSeconds)
	assert.Equal(t, uint64(1024), sample.received)
	assert.Equal(t, uint64(2048), sample.transmitted)
}

func TestProcessInfoCommandSupportsBusyBoxFallback(t *testing.T) {
	output := runProbeCommandWithFixtures(t, processInfoCommand, map[string]string{
		"ps": `case "$*" in
  *%cpu*) exit 1 ;;
  "-o pid,ppid,user,stat,rss,comm")
    printf 'PID PPID USER STAT RSS COMMAND\n7 1 root S 256 worker\n'
    ;;
  *) exit 1 ;;
esac`,
	})

	process, ok := parseProcessInfo(strings.TrimSpace(string(output)))
	require.True(t, ok)
	assert.Equal(t, int64(7), process.PID)
	assert.Zero(t, process.CPUPercent)
	assert.Equal(t, uint64(256*1024), process.RSSBytes)
	assert.Equal(t, "worker", process.Command)
}

func TestProcessInfoCommandSupportsPOSIXFallback(t *testing.T) {
	output := runProbeCommandWithFixtures(t, processInfoCommand, map[string]string{
		"ps": `case "$*" in
  "-ef") printf 'UID PID PPID C STIME TTY TIME CMD\nroot 9 1 0 00:00 ? 00:00:00 daemon --flag\n' ;;
  *) exit 1 ;;
esac`,
	})

	process, ok := parseProcessInfo(strings.TrimSpace(string(output)))
	require.True(t, ok)
	assert.Equal(t, int64(9), process.PID)
	assert.Equal(t, int64(1), process.PPID)
	assert.Equal(t, "root", process.User)
	assert.Equal(t, "daemon --flag", process.Command)
	assert.Zero(t, process.MemoryBytes)
}

func TestProcessInfoCommandProducesParsableOutput(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("process probe requires a POSIX shell")
	}
	output, err := exec.Command("sh", "-c", processInfoCommand).CombinedOutput()
	require.NoError(t, err)
	for _, line := range strings.Split(string(output), "\n") {
		if _, ok := parseProcessInfo(line); ok {
			return
		}
	}
	t.Fatal("process probe produced no parsable rows")
}

func TestParseSystemInfoRejectsInvalidDirectCPUPercent(t *testing.T) {
	for _, value := range []string{"-1", "101", "NaN", "+Inf"} {
		values := []string{
			"CPUPERCENT", value, "MEMTOTAL", "10", "MEMAVAILABLE", "5",
			"NET", "1", "2", "DISK", "1", "2", "CPUCOUNT", "4",
		}
		_, _, err := parseSystemInfo(values)
		assert.ErrorContains(t, err, "invalid system info field CPUPERCENT")
	}
}

func TestUpdateSystemRatesPreservesDirectCPUPercent(t *testing.T) {
	service := &TerminalService{systemSamples: make(map[string]systemSample)}
	service.systemSamples["term-1"] = systemSample{at: time.Now().Add(-time.Second)}
	info := &model.SystemInfo{CPUPercent: 37.5}

	service.updateSystemRates("term-1", info, systemSample{}, time.Now())

	assert.Equal(t, 37.5, info.CPUPercent)
}

func TestSystemProbeCommandsUseValidShellSyntax(t *testing.T) {
	for _, command := range []string{systemInfoCommand, processInfoCommand} {
		cmd := exec.Command("sh", "-n", "-c", command)
		require.NoError(t, cmd.Run())
	}
}

func runProbeCommandWithFixtures(t *testing.T, command string, fixtures map[string]string) []byte {
	t.Helper()
	fixtureDir := t.TempDir()
	for name, body := range fixtures {
		path := filepath.Join(fixtureDir, name)
		content := []byte("#!/bin/sh\n" + body + "\n")
		require.NoError(t, os.WriteFile(path, content, 0o700))
	}
	cmd := exec.Command("sh", "-c", command)
	cmd.Env = append(os.Environ(), "PATH="+fixtureDir+":"+os.Getenv("PATH"))
	output, err := cmd.CombinedOutput()
	require.NoErrorf(t, err, "probe output: %s", output)
	return output
}

func darwinProbeFixtures() map[string]string {
	return map[string]string{
		"uname": `if [ "$1" = "-s" ]; then echo Darwin; else echo 23.6.0; fi`,
		"sysctl": `case "$*" in
  "-n vm.loadavg") echo '{ 1.00 2.00 3.00 }' ;;
  "-n kern.boottime") echo '{ sec = 1000, usec = 0 }' ;;
  "-n hw.ncpu") echo 8 ;;
  "-n hw.memsize") echo 17179869184 ;;
  "-n vm.swapusage") echo 'total = 2048.00M used = 512.00M free = 1536.00M' ;;
  *) exit 1 ;;
esac`,
		"top":     `echo 'CPU usage: 10.0% user, 20.0% sys, 70.0% idle'`,
		"vm_stat": `printf 'Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 100.\nPages inactive: 200.\nPages speculative: 50.\n'`,
		"netstat": `printf 'Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes\nen0 1500 link addr 10 0 1024 20 0 2048\nlo0 16384 link addr 1 0 99 1 0 99\n'`,
		"df":      `printf 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk 1000 400 600 40%% /\n'`,
		"sw_vers": `if [ "$1" = "-productName" ]; then echo macOS; else echo 15.0; fi`,
	}
}
