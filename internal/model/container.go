package model

const (
	ContainerEngineDocker     = "docker"
	ContainerEnginePodman     = "podman"
	ContainerEngineContainerd = "containerd"
)

type ContainerEngineInfo struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Available bool   `json:"available"`
	Error     string `json:"error"`
}

type ContainerInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Engine    string `json:"engine"`
	Namespace string `json:"namespace"`
	Image     string `json:"image"`
	State     string `json:"state"`
	Status    string `json:"status"`
	Ports     string `json:"ports"`
}

type ContainerOverview struct {
	Engines    []ContainerEngineInfo `json:"engines"`
	Containers []ContainerInfo       `json:"containers"`
}

type ContainerActionRequest struct {
	Engine    string `json:"engine"`
	Namespace string `json:"namespace"`
	ID        string `json:"id"`
	Action    string `json:"action"`
}

type ContainerCreateRequest struct {
	Engine        string   `json:"engine"`
	Namespace     string   `json:"namespace"`
	Image         string   `json:"image"`
	Name          string   `json:"name"`
	Command       []string `json:"command"`
	Env           []string `json:"env"`
	Ports         []string `json:"ports"`
	Volumes       []string `json:"volumes"`
	RestartPolicy string   `json:"restart_policy"`
}
