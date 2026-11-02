package service

import (
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

type networkCounter struct {
	received    uint64
	transmitted uint64
}

type systemSample struct {
	total, idle, iowait, received, transmitted uint64
	interfaces                                 map[string]networkCounter
	at                                         time.Time
	sampledAtMS                                int64
	monotonicMS                                uint64
	hasCPU                                     bool
	hasSwap                                    bool
	hasNetwork                                 bool
	hasInterfaces                              bool
	hasDisk                                    bool
	hasLoad                                    bool
	hasUptime                                  bool
}

type processKey struct {
	pid        int64
	startTicks uint64
}

type processSample struct {
	totalTicks uint64
	ticks      map[processKey]uint64
}

func (t *TerminalService) updateSystemRates(terminalID string, info *model.SystemInfo, sample systemSample, now time.Time) {
	stored := sample
	stored.at = now
	stored.interfaces = cloneNetworkCounters(sample.interfaces)
	t.systemMu.Lock()
	if t.systemSamples == nil {
		t.systemSamples = make(map[string]systemSample)
	}
	previous, exists := t.systemSamples[terminalID]
	t.systemSamples[terminalID] = stored
	t.systemMu.Unlock()
	if !exists {
		return
	}
	elapsed := systemSampleElapsed(previous, stored)
	if elapsed <= 0 {
		return
	}
	if previous.total > 0 && sample.total > 0 {
		info.CPUPercent = cpuPercent(previous, sample)
	}
	if sample.hasInterfaces {
		applyInterfaceRates(info, previous, elapsed)
		return
	}
	info.DownloadRate = byteRate(previous.received, sample.received, elapsed)
	info.UploadRate = byteRate(previous.transmitted, sample.transmitted, elapsed)
}

func applyInterfaceRates(info *model.SystemInfo, previous systemSample, elapsed float64) {
	aggregateDownload, aggregateUpload := uint64(0), uint64(0)
	hasPhysical := false
	for index := range info.Interfaces {
		networkInterface := &info.Interfaces[index]
		before, exists := previous.interfaces[networkInterface.Name]
		if exists {
			networkInterface.DownloadRate = byteRate(before.received, networkInterface.ReceivedBytes, elapsed)
			networkInterface.UploadRate = byteRate(before.transmitted, networkInterface.TransmittedBytes, elapsed)
		}
		if !networkInterface.Virtual {
			hasPhysical = true
			aggregateDownload += networkInterface.DownloadRate
			aggregateUpload += networkInterface.UploadRate
		}
	}
	if !hasPhysical {
		for _, networkInterface := range info.Interfaces {
			if strings.HasPrefix(networkInterface.Name, "lo") {
				continue
			}
			aggregateDownload += networkInterface.DownloadRate
			aggregateUpload += networkInterface.UploadRate
		}
	}
	info.DownloadRate = aggregateDownload
	info.UploadRate = aggregateUpload
}

func cloneNetworkCounters(source map[string]networkCounter) map[string]networkCounter {
	if len(source) == 0 {
		return nil
	}
	cloned := make(map[string]networkCounter, len(source))
	for name, counter := range source {
		cloned[name] = counter
	}
	return cloned
}

func systemSampleElapsed(previous, current systemSample) float64 {
	if previous.monotonicMS > 0 && current.monotonicMS > previous.monotonicMS {
		return float64(current.monotonicMS-previous.monotonicMS) / 1000
	}
	if previous.sampledAtMS > 0 && current.sampledAtMS > previous.sampledAtMS {
		return float64(current.sampledAtMS-previous.sampledAtMS) / 1000
	}
	if !previous.at.IsZero() && !current.at.IsZero() {
		return current.at.Sub(previous.at).Seconds()
	}
	return 0
}

func (t *TerminalService) deleteSystemSample(terminalID string) {
	t.systemMu.Lock()
	delete(t.systemSamples, terminalID)
	delete(t.systemProcessSamples, terminalID)
	t.systemMu.Unlock()
}

func byteRate(previous, current uint64, elapsed float64) uint64 {
	if current < previous || elapsed <= 0 {
		return 0
	}
	return uint64(float64(current-previous) / elapsed)
}

func cpuPercent(previous, current systemSample) float64 {
	if current.total < previous.total || current.idle < previous.idle || current.iowait < previous.iowait {
		return 0
	}
	total := current.total - previous.total
	idle := current.idle - previous.idle
	iowait := current.iowait - previous.iowait
	if total == 0 || idle+iowait > total {
		return 0
	}
	return float64(total-idle-iowait) / float64(total) * 100
}
