package service

import "github.com/xuthus5/mssh/internal/model"

func (t *TerminalService) updateProcessCPUs(terminalID string, probe processProbe, processes []model.ProcessInfo) {
	if probe.mode != "procfs" || probe.totalTicks == 0 || len(probe.readings) == 0 {
		return
	}
	current := processSample{totalTicks: probe.totalTicks, ticks: make(map[processKey]uint64, len(probe.readings))}
	for _, reading := range probe.readings {
		current.ticks[processKey{pid: reading.info.PID, startTicks: reading.startTicks}] = reading.ticks
	}
	t.systemMu.Lock()
	if t.systemProcessSamples == nil {
		t.systemProcessSamples = make(map[string]processSample)
	}
	previous, exists := t.systemProcessSamples[terminalID]
	t.systemProcessSamples[terminalID] = current
	t.systemMu.Unlock()
	if !exists || probe.totalTicks <= previous.totalTicks {
		return
	}
	totalDelta := probe.totalTicks - previous.totalTicks
	cpuCount := probe.cpuCount
	if cpuCount == 0 {
		cpuCount = 1
	}
	maxPercent := float64(cpuCount * 100)
	for index, reading := range probe.readings {
		key := processKey{pid: reading.info.PID, startTicks: reading.startTicks}
		before, ok := previous.ticks[key]
		if !ok || reading.ticks < before {
			continue
		}
		percent := float64(reading.ticks-before) / float64(totalDelta) * float64(cpuCount) * 100
		if percent > maxPercent {
			percent = maxPercent
		}
		processes[index].CPUPercent = percent
	}
}
