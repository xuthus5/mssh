package service

import (
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func (t *TerminalService) updateSystemRates(terminalID string, info *model.SystemInfo, sample systemSample, now time.Time) {
	t.systemMu.Lock()
	if t.systemSamples == nil {
		t.systemSamples = make(map[string]systemSample)
	}
	previous, exists := t.systemSamples[terminalID]
	t.systemSamples[terminalID] = systemSample{total: sample.total, idle: sample.idle, received: sample.received, transmitted: sample.transmitted, at: now}
	t.systemMu.Unlock()
	if !exists {
		return
	}
	elapsed := now.Sub(previous.at).Seconds()
	if elapsed <= 0 {
		return
	}
	info.CPUPercent = cpuPercent(previous, sample)
	info.DownloadRate = byteRate(previous.received, sample.received, elapsed)
	info.UploadRate = byteRate(previous.transmitted, sample.transmitted, elapsed)
}

func (t *TerminalService) deleteSystemSample(terminalID string) {
	t.systemMu.Lock()
	delete(t.systemSamples, terminalID)
	t.systemMu.Unlock()
}

func byteRate(previous, current uint64, elapsed float64) uint64 {
	if current < previous || elapsed <= 0 {
		return 0
	}
	return uint64(float64(current-previous) / elapsed)
}
