package model

type HostKeyEntry struct {
	Line        int    `json:"line"`
	Hosts       string `json:"hosts"`
	Algorithm   string `json:"algorithm"`
	Fingerprint string `json:"fingerprint"`
}
