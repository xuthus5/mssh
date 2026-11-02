package service

import (
	"errors"
	"math"
	"strconv"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

func parseSystemMetadataField(result *model.SystemInfo, sample *systemSample, values []string, valid *bool) int {
	if consumed := parseProtocolMetadataField(result, values, valid); consumed != 0 {
		return consumed
	}
	return parseSystemLabelField(result, sample, values, valid)
}

func parseProtocolMetadataField(result *model.SystemInfo, values []string, valid *bool) int {
	switch values[0] {
	case "SCHEMA":
		schema, err := strconv.Atoi(values[1])
		*valid = *valid && err == nil && schema == model.SystemInfoSchemaVersion
		result.SchemaVersion = schema
	case "SOURCE":
		result.Source = trimField(values[1])
		*valid = *valid && result.Source != ""
	case "SAMPLE":
		if len(values) < 3 {
			return -1
		}
		sampledAt, sampledErr := strconv.ParseInt(values[1], 10, 64)
		monotonic, monotonicErr := strconv.ParseUint(values[2], 10, 64)
		*valid = *valid && sampledErr == nil && monotonicErr == nil && sampledAt >= 0
		result.SampledAtUnixMS = sampledAt
		result.SampledMonotonicMS = monotonic
		return 3
	case "CAP":
		length := systemInfoValueLength(values)
		if length < 2 {
			*valid = false
			return -1
		}
		for _, capability := range values[1:length] {
			if capability = trimField(capability); capability != "" && !containsStringValue(result.Capabilities, capability) {
				result.Capabilities = append(result.Capabilities, capability)
			}
		}
		return length
	case "WARN":
		if code := trimField(values[1]); code != "" {
			addSystemWarning(result, code)
		}
	default:
		return 0
	}
	return 2
}

func containsStringValue(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func parseSystemLabelField(result *model.SystemInfo, sample *systemSample, values []string, valid *bool) int {
	switch values[0] {
	case "OS":
		length := systemInfoValueLength(values)
		if length < 2 {
			return -1
		}
		result.OSName = strings.Join(values[1:length], " ")
		return length
	case "KERNEL":
		result.KernelVersion = trimField(values[1])
	case "UPTIME":
		uptime, err := parseFloatField(values[1], valid)
		if err == nil && *valid && uptime >= 0 {
			result.UptimeSeconds = int64(uptime)
			sample.hasUptime = true
		} else {
			*valid = false
		}
	default:
		return 0
	}
	return 2
}

func parseSystemIOField(result *model.SystemInfo, sample *systemSample, values []string, uint func(string) uint64, float func(string) float64, valid *bool) int {
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
	case "CPUPERCENT":
		percent := float(values[1])
		if percent < 0 || percent > 100 {
			*valid = false
		} else {
			result.CPUPercent = percent
			sample.hasCPU = true
		}
	case "IOWAIT":
		sample.iowait = uint(values[1])
	case "CPUCOUNT":
		count, err := strconv.Atoi(values[1])
		*valid = *valid && err == nil && count > 0
		result.CPUCount = count
	case "SWAPTOTAL":
		result.SwapTotal = uint(values[1])
		sample.hasSwap = true
	case "SWAPFREE":
		free := uint(values[1])
		if free > result.SwapTotal {
			*valid = false
		} else {
			result.SwapUsed = result.SwapTotal - free
		}
	default:
		return 0
	}
	return 2
}

func parseSystemTopologyField(result *model.SystemInfo, sample *systemSample, values []string, uint func(string) uint64, valid *bool) int {
	switch values[0] {
	case "NETIF":
		return parseSystemNetworkInterfaceField(result, sample, values, uint, valid)
	case "NETROLE":
		return parseSystemNetworkRoleField(result, sample, values, valid)
	case "DISKMOUNT":
		return parseSystemDiskMountField(result, sample, values, uint, valid)
	default:
		return 0
	}
}

func parseSystemDiskMountField(result *model.SystemInfo, sample *systemSample, values []string, uint func(string) uint64, valid *bool) int {
	if len(values) < 6 {
		return -1
	}
	mount := model.DiskMount{
		Device: unescapeDiskField(values[1]), MountPoint: unescapeDiskField(values[2]),
		UsedBytes: uint(values[3]), TotalBytes: uint(values[4]), AvailableBytes: uint(values[5]),
	}
	if mount.MountPoint == "" {
		*valid = false
		return 6
	}
	result.DiskMounts = append(result.DiskMounts, mount)
	sample.hasDisk = true
	return 6
}

func parseUintField(value string, valid *bool) (uint64, error) {
	parsed, err := strconv.ParseUint(value, 10, 64)
	*valid = *valid && err == nil
	return parsed, err
}

func unescapeDiskField(value string) string {
	return strings.ReplaceAll(trimField(value), `\040`, " ")
}

func parseFloatField(value string, valid *bool) (float64, error) {
	parsed, err := strconv.ParseFloat(value, 64)
	parsedValid := err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0)
	*valid = *valid && parsedValid
	if err == nil && !parsedValid {
		err = errors.New("non-finite float")
	}
	return parsed, err
}
