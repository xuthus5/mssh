package model

type AboutInfo struct {
	CurrentVersion string `json:"current_version"`
	RepositoryURL  string `json:"repository_url"`
}

type UpdateInfo struct {
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version"`
	ReleaseURL      string `json:"release_url"`
	UpdateAvailable bool   `json:"update_available"`
}
