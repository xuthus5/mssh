package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

type dockerPortBinding struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}

type dockerContainerInspect struct {
	Name   string `json:"Name"`
	Image  string `json:"Image"`
	Config struct {
		Image      string   `json:"Image"`
		Cmd        []string `json:"Cmd"`
		Entrypoint []string `json:"Entrypoint"`
		Env        []string `json:"Env"`
		WorkingDir string   `json:"WorkingDir"`
		User       string   `json:"User"`
	} `json:"Config"`
	HostConfig struct {
		PortBindings  map[string][]dockerPortBinding `json:"PortBindings"`
		RestartPolicy struct {
			Name              string `json:"Name"`
			MaximumRetryCount int    `json:"MaximumRetryCount"`
		} `json:"RestartPolicy"`
		NetworkMode    string `json:"NetworkMode"`
		AutoRemove     bool   `json:"AutoRemove"`
		Privileged     bool   `json:"Privileged"`
		ReadonlyRootfs bool   `json:"ReadonlyRootfs"`
	} `json:"HostConfig"`
	Mounts []struct {
		Type        string `json:"Type"`
		Name        string `json:"Name"`
		Source      string `json:"Source"`
		Destination string `json:"Destination"`
		RW          bool   `json:"RW"`
	} `json:"Mounts"`
}

type containerdProcessSpec struct {
	Args []string `json:"args"`
	Env  []string `json:"env"`
	User struct {
		UID uint32 `json:"uid"`
		GID uint32 `json:"gid"`
	} `json:"user"`
}

type containerdContainerInspect struct {
	ID    string `json:"ID"`
	Image string `json:"Image"`
	Spec  struct {
		Process containerdProcessSpec `json:"process"`
		Mounts  []struct {
			Destination string   `json:"destination"`
			Type        string   `json:"type"`
			Source      string   `json:"source"`
			Options     []string `json:"options"`
		} `json:"mounts"`
	} `json:"Spec"`
}

func buildContainerRunCommand(engine, namespace string, output []byte) (string, error) {
	if err := validateContainerEngine(engine); err != nil {
		return "", err
	}
	switch engine {
	case model.ContainerEngineContainerd:
		namespace, err := validateContainerNamespace(engine, namespace)
		if err != nil {
			return "", err
		}
		return buildContainerdRunCommand(namespace, output)
	default:
		return buildDockerRunCommand(engine, output)
	}
}

func buildDockerRunCommand(engine string, output []byte) (string, error) {
	var inspect dockerContainerInspect
	if err := json.Unmarshal(output, &inspect); err != nil {
		return "", fmt.Errorf("decode %s container inspect: %w", engine, err)
	}
	image := strings.TrimSpace(inspect.Config.Image)
	if image == "" {
		image = strings.TrimSpace(inspect.Image)
	}
	if image == "" {
		return "", errors.New("container image is unavailable")
	}
	args := []string{engine, "run", "-d"}
	if name := strings.TrimPrefix(inspect.Name, "/"); name != "" {
		args = append(args, "--name", name)
	}
	if policy := dockerRestartPolicy(inspect); policy != "" {
		args = append(args, "--restart", policy)
	}
	if inspect.HostConfig.AutoRemove {
		args = append(args, "--rm")
	}
	if inspect.HostConfig.Privileged {
		args = append(args, "--privileged")
	}
	if inspect.HostConfig.ReadonlyRootfs {
		args = append(args, "--read-only")
	}
	if network := inspect.HostConfig.NetworkMode; network != "" && network != "default" && network != "bridge" {
		args = append(args, "--network", network)
	}
	for _, value := range inspect.Config.Env {
		args = append(args, "--env", value)
	}
	args = append(args, dockerPortArgs(inspect.HostConfig.PortBindings)...)
	args = append(args, dockerMountArgs(inspect.Mounts)...)
	if inspect.Config.WorkingDir != "" {
		args = append(args, "--workdir", inspect.Config.WorkingDir)
	}
	if inspect.Config.User != "" {
		args = append(args, "--user", inspect.Config.User)
	}
	command := append([]string(nil), inspect.Config.Cmd...)
	if len(inspect.Config.Entrypoint) > 0 {
		args = append(args, "--entrypoint", inspect.Config.Entrypoint[0])
		command = append(append([]string(nil), inspect.Config.Entrypoint[1:]...), command...)
	}
	args = append(args, image)
	args = append(args, command...)
	return joinShellArgs(args), nil
}

func dockerRestartPolicy(inspect dockerContainerInspect) string {
	policy := inspect.HostConfig.RestartPolicy
	if policy.Name == "" || policy.Name == "no" {
		return ""
	}
	if policy.Name == "on-failure" && policy.MaximumRetryCount > 0 {
		return fmt.Sprintf("%s:%d", policy.Name, policy.MaximumRetryCount)
	}
	return policy.Name
}

func dockerPortArgs(bindings map[string][]dockerPortBinding) []string {
	keys := make([]string, 0, len(bindings))
	for key := range bindings {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	args := make([]string, 0)
	for _, key := range keys {
		containerPort, protocol, found := strings.Cut(key, "/")
		if !found {
			protocol = "tcp"
		}
		values := append([]dockerPortBinding(nil), bindings[key]...)
		sort.Slice(values, func(left, right int) bool {
			return values[left].HostIP+values[left].HostPort < values[right].HostIP+values[right].HostPort
		})
		for _, binding := range values {
			spec := containerPort
			if binding.HostPort != "" {
				spec = binding.HostPort + ":" + spec
			}
			if binding.HostIP != "" && binding.HostIP != "0.0.0.0" && binding.HostIP != "::" {
				spec = binding.HostIP + ":" + spec
			}
			if protocol != "" {
				spec += "/" + protocol
			}
			args = append(args, "--publish", spec)
		}
	}
	return args
}

func dockerMountArgs(mounts []struct {
	Type        string `json:"Type"`
	Name        string `json:"Name"`
	Source      string `json:"Source"`
	Destination string `json:"Destination"`
	RW          bool   `json:"RW"`
}) []string {
	args := make([]string, 0)
	for _, mount := range mounts {
		if mount.Destination == "" {
			continue
		}
		if mount.Type == "tmpfs" {
			args = append(args, "--tmpfs", mount.Destination)
			continue
		}
		source := mount.Source
		if mount.Type == "volume" && mount.Name != "" {
			source = mount.Name
		}
		if source == "" {
			continue
		}
		spec := source + ":" + mount.Destination
		if !mount.RW {
			spec += ":ro"
		}
		args = append(args, "--volume", spec)
	}
	return args
}

func buildContainerdRunCommand(namespace string, output []byte) (string, error) {
	var inspect containerdContainerInspect
	if err := json.Unmarshal(output, &inspect); err != nil {
		return "", fmt.Errorf("decode containerd container inspect: %w", err)
	}
	if strings.TrimSpace(inspect.Image) == "" || strings.TrimSpace(inspect.ID) == "" {
		return "", errors.New("containerd container metadata is incomplete")
	}
	args := []string{"ctr", "--namespace", namespace, "run", "-d"}
	for _, value := range inspect.Spec.Process.Env {
		args = append(args, "--env", value)
	}
	for _, mount := range inspect.Spec.Mounts {
		if mount.Destination == "" || mount.Type == "" || mount.Source == "" {
			continue
		}
		value := "type=" + mount.Type + ",src=" + mount.Source + ",dst=" + mount.Destination
		if len(mount.Options) > 0 {
			value += ",options=" + strings.Join(mount.Options, ";")
		}
		args = append(args, "--mount", value)
	}
	uid, gid := inspect.Spec.Process.User.UID, inspect.Spec.Process.User.GID
	if uid != 0 || gid != 0 {
		args = append(args, "--user", fmt.Sprintf("%d:%d", uid, gid))
	}
	args = append(args, inspect.Image, inspect.ID)
	args = append(args, inspect.Spec.Process.Args...)
	return joinShellArgs(args), nil
}
