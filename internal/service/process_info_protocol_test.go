package service

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
)

func TestParseProcessProbeStructured(t *testing.T) {
	output := "SCHEMA 1\nMODE procfs\nCPUCOUNT 4\nCPUTOTAL 1000\n" +
		"PROC\t10\t1\troot\tS\t1024\t100\t50\ttmux server\ninvalid row\n"
	probe := parseProcessProbe(output)
	assert.Equal(t, "procfs", probe.mode)
	assert.Equal(t, uint64(4), probe.cpuCount)
	assert.Equal(t, uint64(1000), probe.totalTicks)
	require.Len(t, probe.readings, 1)
	assert.Equal(t, int64(10), probe.readings[0].info.PID)
	assert.Equal(t, "tmux server", probe.readings[0].info.Command)
	assert.Equal(t, processCPUSourceProcfs, probe.readings[0].info.CPUSource)
	assert.Equal(t, uint64(100), probe.readings[0].ticks)
	assert.Equal(t, uint64(50), probe.readings[0].startTicks)
	assert.Equal(t, 1, probe.schema)
}

func TestParseProcessProbeFallsBackToPSRows(t *testing.T) {
	probe := parseProcessProbe("10 1 root S 9.5 1024 tmux server\n11 1 dev R bad 2048 vim")
	assert.Equal(t, "ps", probe.mode)
	require.Len(t, probe.readings, 1)
	assert.Equal(t, processCPUSourcePS, probe.readings[0].info.CPUSource)
}

func TestParseProcessProbeHeaderRejectsMalformedValues(t *testing.T) {
	probe := processProbe{}
	assert.True(t, parseProcessProbeHeader(&probe, []string{"SCHEMA", "1"}))
	assert.Equal(t, 1, probe.schema)
	assert.True(t, parseProcessProbeHeader(&probe, []string{"MODE"}))
	assert.True(t, parseProcessProbeHeader(&probe, []string{"CPUCOUNT", "invalid"}))
	assert.True(t, parseProcessProbeHeader(&probe, []string{"CPUTOTAL", "invalid"}))
	assert.False(t, parseProcessProbeHeader(&probe, []string{"UNKNOWN"}))
	assert.Zero(t, probe.cpuCount)
	assert.Zero(t, probe.totalTicks)
}

func TestParseProcessProbeHeaderRejectsInvalidSchema(t *testing.T) {
	tests := []struct {
		fields []string
		want   int
	}{
		{fields: []string{"SCHEMA"}, want: -1},
		{fields: []string{"SCHEMA", "invalid"}, want: -1},
		{fields: []string{"SCHEMA", "2"}, want: 2},
	}
	for _, test := range tests {
		probe := processProbe{}
		assert.True(t, parseProcessProbeHeader(&probe, test.fields))
		assert.Equal(t, test.want, probe.schema)
	}
}

func TestTruncateProcessCommand(t *testing.T) {
	assert.Equal(t, "short", truncateProcessCommand("short"))
	command := strings.Repeat("x", maxProcessCommandBytes+1)
	assert.Len(t, truncateProcessCommand(command), maxProcessCommandBytes)
}

func TestParseProcReadingRejectsMalformedRows(t *testing.T) {
	for _, line := range []string{
		"PROC\t10\t1\troot\tS\t1024",
		"PROC\tinvalid\t1\troot\tS\t1024\t100\t50\ttmux",
		"PROC\t10\t1\troot\tS\tinvalid\t100\t50\ttmux",
		"PROC\t10\t1\troot\tS\t1024\tinvalid\t50\ttmux",
		"PROC\t10\t1\troot\tS\t1024\t100\tinvalid\ttmux",
	} {
		_, ok := parseProcReading(line)
		assert.False(t, ok, line)
	}
}

func TestUpdateProcessCPUsCalculatesInstantaneousPercent(t *testing.T) {
	start := uint64(50)
	service := &TerminalService{systemProcessSamples: map[string]processSample{
		"term-1": {totalTicks: 1000, ticks: map[processKey]uint64{{pid: 10, startTicks: start}: 100}},
	}}
	probe := processProbe{
		mode: "procfs", cpuCount: 4, totalTicks: 1400,
		readings: []processReading{{info: model.ProcessInfo{PID: 10}, ticks: 200, startTicks: start}},
	}
	processes := []model.ProcessInfo{{PID: 10}}
	service.updateProcessCPUs("term-1", probe, processes)
	assert.InDelta(t, 100.0, processes[0].CPUPercent, 0.001)
}

func TestUpdateProcessCPUsIgnoresNewAndReusedProcesses(t *testing.T) {
	service := &TerminalService{systemProcessSamples: map[string]processSample{
		"term-1": {totalTicks: 1000, ticks: map[processKey]uint64{{pid: 10, startTicks: 50}: 100}},
	}}
	probe := processProbe{
		mode: "procfs", cpuCount: 4, totalTicks: 1400,
		readings: []processReading{
			{info: model.ProcessInfo{PID: 10}, ticks: 200, startTicks: 51},
			{info: model.ProcessInfo{PID: 11}, ticks: 200, startTicks: 60},
		},
	}
	processes := []model.ProcessInfo{{PID: 10}, {PID: 11}}
	service.updateProcessCPUs("term-1", probe, processes)
	assert.Zero(t, processes[0].CPUPercent)
	assert.Zero(t, processes[1].CPUPercent)
}

func TestUpdateProcessCPUsClampsPercent(t *testing.T) {
	start := uint64(50)
	service := &TerminalService{systemProcessSamples: map[string]processSample{
		"term-1": {totalTicks: 1000, ticks: map[processKey]uint64{{pid: 10, startTicks: start}: 0}},
	}}
	probe := processProbe{
		mode: "procfs", cpuCount: 0, totalTicks: 1001,
		readings: []processReading{{info: model.ProcessInfo{PID: 10}, ticks: 100, startTicks: start}},
	}
	processes := []model.ProcessInfo{{PID: 10}}
	service.updateProcessCPUs("term-1", probe, processes)
	assert.Equal(t, 100.0, processes[0].CPUPercent)
}

func TestUpdateProcessCPUsSkipsIncompleteProbes(t *testing.T) {
	service := &TerminalService{}
	processes := []model.ProcessInfo{{PID: 10}}
	service.updateProcessCPUs("term-1", processProbe{mode: "ps"}, processes)
	service.updateProcessCPUs("term-1", processProbe{mode: "procfs"}, processes)
	service.updateProcessCPUs("term-1", processProbe{mode: "procfs", totalTicks: 10}, processes)
	assert.Zero(t, processes[0].CPUPercent)
}

func TestTerminalServiceProcessInfoUsesProcfsDelta(t *testing.T) {
	originalCommand := _runSystemInfoCommand
	originalProbe := _openSystemProbeConnection
	t.Cleanup(func() {
		_runSystemInfoCommand = originalCommand
		_openSystemProbeConnection = originalProbe
	})
	outputs := []string{
		"SCHEMA 1\nMODE procfs\nCPUCOUNT 4\nCPUTOTAL 1000\nPROC\t10\t1\troot\tS\t1024\t100\t50\ttmux server\n",
		"SCHEMA 1\nMODE procfs\nCPUCOUNT 4\nCPUTOTAL 1400\nPROC\t10\t1\troot\tS\t1024\t200\t50\ttmux server\n",
	}
	calls := 0
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, command string) ([]byte, error) {
		require.Equal(t, processInfoCommand, command)
		output := outputs[calls]
		calls++
		return []byte(output), nil
	}
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return &ssh.ClientWrapper{}, func() {}, nil
	}
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	service.sessionIDs["term-1"] = 1

	first, err := service.ProcessInfo("term-1")
	require.NoError(t, err)
	assert.Zero(t, first[0].CPUPercent)
	second, err := service.ProcessInfo("term-1")
	require.NoError(t, err)
	assert.InDelta(t, 100.0, second[0].CPUPercent, 0.001)
}

func TestTerminalServiceProcessInfoReturnsProbeFailure(t *testing.T) {
	originalCommand := _runSystemInfoCommand
	originalProbe := _openSystemProbeConnection
	t.Cleanup(func() {
		_runSystemInfoCommand = originalCommand
		_openSystemProbeConnection = originalProbe
	})
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return &ssh.ClientWrapper{}, func() {}, nil
	}
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) {
		return nil, errors.New("process probe failed")
	}
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	service.sessionIDs["term-1"] = 1
	_, err := service.ProcessInfo("term-1")
	require.ErrorContains(t, err, "process probe failed")
}

func TestTerminalServiceProcessInfoRejectsUnsupportedSchema(t *testing.T) {
	originalCommand := _runSystemInfoCommand
	originalProbe := _openSystemProbeConnection
	t.Cleanup(func() {
		_runSystemInfoCommand = originalCommand
		_openSystemProbeConnection = originalProbe
	})
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return &ssh.ClientWrapper{}, func() {}, nil
	}
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) {
		return []byte("SCHEMA 2\nMODE procfs\nCPUCOUNT 4\nCPUTOTAL 1000\nPROC\t10\t1\troot\tS\t1024\t100\t50\ttmux\n"), nil
	}
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	service.sessionIDs["term-1"] = 1
	_, err := service.ProcessInfo("term-1")
	require.ErrorContains(t, err, "unsupported process info schema 2")
}
