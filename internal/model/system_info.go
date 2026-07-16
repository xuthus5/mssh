package model

type SystemInfo struct {
	CPUPercent    float64            `json:"cpu_percent"`
	CPUCount      int                `json:"cpu_count"`
	MemoryUsed    uint64             `json:"memory_used"`
	MemoryTotal   uint64             `json:"memory_total"`
	DiskUsed      uint64             `json:"disk_used"`
	DiskTotal     uint64             `json:"disk_total"`
	DownloadRate  uint64             `json:"download_rate"`
	UploadRate    uint64             `json:"upload_rate"`
	SwapUsed      uint64             `json:"swap_used"`
	SwapTotal     uint64             `json:"swap_total"`
	Load1         float64            `json:"load_1"`
	Load5         float64            `json:"load_5"`
	Load15        float64            `json:"load_15"`
	UptimeSeconds int64              `json:"uptime_seconds"`
	OSName        string             `json:"os_name"`
	KernelVersion string             `json:"kernel_version"`
	LatencyMS     float64            `json:"latency_ms"`
	Interfaces    []NetworkInterface `json:"interfaces"`
}

type NetworkInterface struct {
	Name             string `json:"name"`
	ReceivedBytes    uint64 `json:"received_bytes"`
	TransmittedBytes uint64 `json:"transmitted_bytes"`
	DownloadRate     uint64 `json:"download_rate"`
	UploadRate       uint64 `json:"upload_rate"`
}

type ProcessInfo struct {
	PID         int64   `json:"pid"`
	PPID        int64   `json:"ppid"`
	User        string  `json:"user"`
	State       string  `json:"state"`
	CPUPercent  float64 `json:"cpu_percent"`
	MemoryBytes uint64  `json:"memory_bytes"`
	RSSBytes    uint64  `json:"rss_bytes"`
	Command     string  `json:"command"`
}
