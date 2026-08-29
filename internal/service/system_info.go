package service

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

type systemSample struct {
	total, idle, received, transmitted uint64
	at                                 time.Time
}

func (t *TerminalService) SystemInfo(terminalID string) (*model.SystemInfo, error) {
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
	output, err := _runSystemInfoCommand(wrapper, systemInfoCommand)
	if err != nil {
		return nil, err
	}
	info, sample, err := parseSystemInfo(strings.Fields(string(output)))
	if err != nil {
		return nil, err
	}
	t.updateSystemRates(terminalID, info, sample, time.Now())
	return info, nil
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
	processes := make([]model.ProcessInfo, 0)
	for _, line := range strings.Split(string(output), "\n") {
		if process, ok := parseProcessInfo(line); ok {
			processes = append(processes, process)
		}
	}
	return processes, nil
}

func parseProcessInfo(line string) (model.ProcessInfo, bool) {
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
	return model.ProcessInfo{PID: pid, PPID: ppid, User: fields[2], State: fields[3], CPUPercent: cpu, RSSBytes: rss * 1024, MemoryBytes: rss * 1024, Command: strings.Join(fields[6:], " ")}, true
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
			return nil, systemSample{}, fmt.Errorf("unknown system info field %s", values[index])
		}
		index += consumed
	}
	return result, sample, nil
}

func parseSystemInfoField(result *model.SystemInfo, sample *systemSample, values []string) int {
	if len(values) < 2 {
		return 0
	}
	valid := true
	uint := func(value string) uint64 {
		parsed, err := strconv.ParseUint(value, 10, 64)
		valid = valid && err == nil
		return parsed
	}
	float := func(value string) float64 {
		parsed, err := strconv.ParseFloat(value, 64)
		valid = valid && err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0)
		return parsed
	}
	if consumed := parseWideSystemInfoField(result, sample, values, uint, float); consumed != 0 {
		if !valid {
			return -1
		}
		return consumed
	}
	consumed := parseDetailSystemInfoField(result, values, uint, float, &valid)
	if !valid {
		return -1
	}
	return consumed
}

func parseDetailSystemInfoField(result *model.SystemInfo, values []string, uint func(string) uint64, float func(string) float64, valid *bool) int {
	switch values[0] {
	case "MEMTOTAL":
		result.MemoryTotal = uint(values[1])
	case "MEMAVAILABLE":
		available := uint(values[1])
		if available > result.MemoryTotal {
			*valid = false
		} else {
			result.MemoryUsed = result.MemoryTotal - available
		}
	case "UPTIME":
		result.UptimeSeconds = int64(float(values[1]))
	case "KERNEL":
		result.KernelVersion = values[1]
	case "CPUCOUNT":
		count, err := strconv.Atoi(values[1])
		*valid = *valid && err == nil && count > 0
		result.CPUCount = count
	case "CPUPERCENT":
		percent := float(values[1])
		if percent < 0 || percent > 100 {
			*valid = false
		} else {
			result.CPUPercent = percent
		}
	case "SWAPTOTAL":
		result.SwapTotal = uint(values[1])
	case "SWAPFREE":
		free := uint(values[1])
		if result.SwapTotal >= free {
			result.SwapUsed = result.SwapTotal - free
		}
	case "OS":
		length := systemInfoValueLength(values)
		if length < 2 {
			return -1
		}
		result.OSName = strings.Join(values[1:length], " ")
		return length
	default:
		return 0
	}
	return 2
}

func systemInfoValueLength(values []string) int {
	for index := 1; index < len(values); index++ {
		if isSystemInfoField(values[index]) {
			return index
		}
	}
	return len(values)
}

func isSystemInfoField(value string) bool {
	switch value {
	case "CPU", "CPUPERCENT", "MEMTOTAL", "MEMAVAILABLE", "NET", "DISK", "LOAD", "UPTIME", "KERNEL", "OS", "CPUCOUNT", "SWAPTOTAL", "SWAPFREE":
		return true
	default:
		return false
	}
}

func parseWideSystemInfoField(result *model.SystemInfo, sample *systemSample, values []string, uint func(string) uint64, float func(string) float64) int {
	switch values[0] {
	case "CPU":
		if len(values) < 3 {
			return -1
		}
		sample.total, sample.idle = uint(values[1]), uint(values[2])
	case "NET":
		if len(values) < 3 {
			return -1
		}
		sample.received, sample.transmitted = uint(values[1]), uint(values[2])
	case "DISK":
		if len(values) < 3 {
			return -1
		}
		result.DiskUsed, result.DiskTotal = uint(values[1]), uint(values[2])
	case "LOAD":
		if len(values) < 4 {
			return -1
		}
		result.Load1, result.Load5, result.Load15 = float(values[1]), float(values[2]), float(values[3])
		return 4
	default:
		return 0
	}
	return 3
}

func cpuPercent(previous, current systemSample) float64 {
	if current.total < previous.total || current.idle < previous.idle {
		return 0
	}
	total := current.total - previous.total
	idle := current.idle - previous.idle
	if total == 0 || idle > total {
		return 0
	}
	return float64(total-idle) / float64(total) * 100
}
