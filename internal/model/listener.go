package model

type ListeningPortInfo struct {
	Protocol    string `json:"protocol"`
	Address     string `json:"address"`
	Port        int    `json:"port"`
	PID         int64  `json:"pid"`
	ProcessName string `json:"process_name"`
}
