package model

type SystemInfo struct {
	CPUPercent   float64 `json:"cpu_percent"`
	CPUCount     int     `json:"cpu_count"`
	MemoryUsed   uint64  `json:"memory_used"`
	MemoryTotal  uint64  `json:"memory_total"`
	DiskUsed     uint64  `json:"disk_used"`
	DiskTotal    uint64  `json:"disk_total"`
	DownloadRate uint64  `json:"download_rate"`
	UploadRate   uint64  `json:"upload_rate"`
}
