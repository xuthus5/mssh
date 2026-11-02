package service

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	processCPUSourceProcfs = "procfs_delta"
	processCPUSourcePS     = "ps_average"
)

type processReading struct {
	info       model.ProcessInfo
	ticks      uint64
	startTicks uint64
}

type processProbe struct {
	mode       string
	cpuCount   uint64
	totalTicks uint64
	readings   []processReading
}

func (t *TerminalService) ProcessInfo(terminalID string) ([]model.ProcessInfo, error) {
	if err := validateTerminalID(terminalID); err != nil {
		return nil, err
	}
	finish, err := t.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	sessionID, ok := t.terminalSessionID(terminalID)
	if !ok {
		return nil, fmt.Errorf("terminal %s not found", terminalID)
	}
	wrapper, release, err := t.acquireSystemProbeConnection(sessionID)
	if err != nil {
		return nil, err
	}
	defer release()
	output, err := _runSystemInfoCommand(wrapper, processInfoCommand)
	if err != nil {
		return nil, err
	}
	probe := parseProcessProbe(string(output))
	processes := make([]model.ProcessInfo, len(probe.readings))
	for index := range probe.readings {
		processes[index] = probe.readings[index].info
	}
	t.updateProcessCPUs(terminalID, probe, processes)
	return processes, nil
}

func parseProcessProbe(output string) processProbe {
	probe := processProbe{mode: "ps", readings: make([]processReading, 0)}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSuffix(line, "\r")
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if strings.HasPrefix(line, "PROC\t") {
			if reading, ok := parseProcReading(line); ok {
				probe.readings = append(probe.readings, reading)
			}
			continue
		}
		if parseProcessProbeHeader(&probe, fields) {
			continue
		}
		if process, ok := parseProcessInfo(line); ok {
			probe.readings = append(probe.readings, processReading{info: process})
		}
	}
	return probe
}

func parseProcessProbeHeader(probe *processProbe, fields []string) bool {
	switch fields[0] {
	case "SCHEMA":
		return len(fields) >= 2
	case "MODE":
		if len(fields) >= 2 {
			probe.mode = fields[1]
		}
		return true
	case "CPUCOUNT":
		if len(fields) >= 2 {
			probe.cpuCount, _ = strconv.ParseUint(fields[1], 10, 64)
		}
		return true
	case "CPUTOTAL":
		if len(fields) >= 2 {
			probe.totalTicks, _ = strconv.ParseUint(fields[1], 10, 64)
		}
		return true
	default:
		return false
	}
}

func parseProcReading(line string) (processReading, bool) {
	fields := strings.SplitN(strings.TrimSpace(line), "\t", 9)
	if len(fields) < 9 || fields[0] != "PROC" {
		return processReading{}, false
	}
	pid, pidErr := strconv.ParseInt(fields[1], 10, 64)
	ppid, ppidErr := strconv.ParseInt(fields[2], 10, 64)
	rss, rssErr := strconv.ParseUint(fields[5], 10, 64)
	ticks, ticksErr := strconv.ParseUint(fields[6], 10, 64)
	startTicks, startErr := strconv.ParseUint(fields[7], 10, 64)
	if pidErr != nil || ppidErr != nil || rssErr != nil || ticksErr != nil || startErr != nil {
		return processReading{}, false
	}
	info := model.ProcessInfo{
		PID: pid, PPID: ppid, User: fields[3], State: fields[4], RSSBytes: rss * 1024,
		MemoryBytes: rss * 1024, Command: strings.TrimSpace(fields[8]), CPUSource: processCPUSourceProcfs,
	}
	return processReading{info: info, ticks: ticks, startTicks: startTicks}, true
}

func parseProcessInfo(line string) (model.ProcessInfo, bool) {
	line = strings.TrimSpace(line)
	if strings.HasPrefix(line, "PROC\t") {
		reading, ok := parseProcReading(line)
		return reading.info, ok
	}
	fields := strings.Fields(line)
	if len(fields) < 7 {
		return model.ProcessInfo{}, false
	}
	pid, pidErr := strconv.ParseInt(fields[0], 10, 64)
	ppid, ppidErr := strconv.ParseInt(fields[1], 10, 64)
	cpu, cpuErr := strconv.ParseFloat(fields[4], 64)
	rss, rssErr := strconv.ParseUint(fields[5], 10, 64)
	if pidErr != nil || ppidErr != nil || cpuErr != nil || rssErr != nil {
		return model.ProcessInfo{}, false
	}
	return model.ProcessInfo{
		PID: pid, PPID: ppid, User: fields[2], State: fields[3], CPUPercent: cpu,
		RSSBytes: rss * 1024, MemoryBytes: rss * 1024, Command: strings.Join(fields[6:], " "),
		CPUSource: processCPUSourcePS,
	}, true
}
