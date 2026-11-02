package service

import (
	"fmt"
	"sort"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	warningCPUUnavailable     = "cpu_unavailable"
	warningCPUCountMissing    = "cpu_count_unavailable"
	warningMemoryUnavailable  = "memory_unavailable"
	warningSwapUnavailable    = "swap_unavailable"
	warningNetworkUnavailable = "network_unavailable"
	warningDiskUnavailable    = "disk_unavailable"
	warningLoadUnavailable    = "load_unavailable"
	warningUptimeUnavailable  = "uptime_unavailable"
)

func parseSystemInfo(values []string) (*model.SystemInfo, systemSample, error) {
	if len(values) < 3 {
		return nil, systemSample{}, fmt.Errorf("invalid system info response")
	}
	result := &model.SystemInfo{
		Warnings:   make([]string, 0),
		Interfaces: make([]model.NetworkInterface, 0),
		DiskMounts: make([]model.DiskMount, 0),
	}
	sample := systemSample{interfaces: make(map[string]networkCounter)}
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
	applyDiskMountSummary(result)
	sort.SliceStable(result.Interfaces, func(left, right int) bool {
		return result.Interfaces[left].Name < result.Interfaces[right].Name
	})
	sort.SliceStable(result.DiskMounts, func(left, right int) bool {
		return result.DiskMounts[left].MountPoint < result.DiskMounts[right].MountPoint
	})
	addSystemWarnings(result, &sample)
	return result, sample, nil
}

func parseSystemInfoField(result *model.SystemInfo, sample *systemSample, values []string) int {
	if len(values) < 2 {
		return 0
	}
	valid := true
	uint := func(value string) uint64 {
		parsed, _ := parseUintField(value, &valid)
		return parsed
	}
	float := func(value string) float64 {
		parsed, _ := parseFloatField(value, &valid)
		return parsed
	}
	if consumed := parseWideSystemInfoField(result, sample, values, uint, float); consumed != 0 {
		if !valid {
			return -1
		}
		return consumed
	}
	consumed := parseDetailSystemInfoField(result, sample, values, uint, float, &valid)
	if !valid {
		return -1
	}
	return consumed
}

func parseWideSystemInfoField(result *model.SystemInfo, sample *systemSample, values []string, uint func(string) uint64, float func(string) float64) int {
	switch values[0] {
	case "CPU":
		if len(values) < 3 {
			return -1
		}
		sample.total, sample.idle = uint(values[1]), uint(values[2])
		sample.hasCPU = true
	case "NET":
		if len(values) < 3 {
			return -1
		}
		sample.received, sample.transmitted = uint(values[1]), uint(values[2])
		sample.hasNetwork = true
	case "DISK":
		if len(values) < 3 {
			return -1
		}
		result.DiskUsed, result.DiskTotal = uint(values[1]), uint(values[2])
		sample.hasDisk = true
	case "LOAD":
		if len(values) < 4 {
			return -1
		}
		result.Load1, result.Load5, result.Load15 = float(values[1]), float(values[2]), float(values[3])
		sample.hasLoad = true
		return 4
	default:
		return 0
	}
	return 3
}

func parseDetailSystemInfoField(result *model.SystemInfo, sample *systemSample, values []string, uint func(string) uint64, float func(string) float64, valid *bool) int {
	if consumed := parseSystemMetadataField(result, sample, values, valid); consumed != 0 {
		return consumed
	}
	if consumed := parseSystemIOField(result, sample, values, uint, float, valid); consumed != 0 {
		return consumed
	}
	return parseSystemTopologyField(result, sample, values, uint, valid)
}

func addSystemWarnings(result *model.SystemInfo, sample *systemSample) {
	checks := []struct {
		missing bool
		code    string
	}{
		{!sample.hasCPU, warningCPUUnavailable},
		{result.CPUCount <= 0, warningCPUCountMissing},
		{result.MemoryTotal == 0, warningMemoryUnavailable},
		{!sample.hasSwap, warningSwapUnavailable},
		{!sample.hasNetwork, warningNetworkUnavailable},
		{!sample.hasDisk, warningDiskUnavailable},
		{!sample.hasLoad, warningLoadUnavailable},
		{!sample.hasUptime, warningUptimeUnavailable},
	}
	for _, check := range checks {
		if check.missing {
			addSystemWarning(result, check.code)
		}
	}
}

func addSystemWarning(result *model.SystemInfo, code string) {
	for _, warning := range result.Warnings {
		if warning == code {
			return
		}
	}
	result.Warnings = append(result.Warnings, code)
}

func applyDiskMountSummary(result *model.SystemInfo) {
	if len(result.DiskMounts) == 0 {
		return
	}
	for _, mount := range result.DiskMounts {
		if mount.MountPoint == "/" {
			result.DiskUsed, result.DiskTotal = mount.UsedBytes, mount.TotalBytes
			return
		}
	}
	if result.DiskTotal == 0 {
		result.DiskUsed, result.DiskTotal = result.DiskMounts[0].UsedBytes, result.DiskMounts[0].TotalBytes
	}
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
	case "SCHEMA", "SOURCE", "SAMPLE", "WARN", "CPU", "CPUPERCENT", "IOWAIT", "MEMTOTAL",
		"MEMAVAILABLE", "NET", "NETIF", "DISK", "DISKMOUNT", "LOAD", "UPTIME", "KERNEL", "OS",
		"CPUCOUNT", "SWAPTOTAL", "SWAPFREE":
		return true
	default:
		return false
	}
}

func trimField(value string) string {
	return strings.TrimSpace(value)
}
