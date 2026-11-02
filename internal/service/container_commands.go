package service

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

const containerOverviewCommand = `LC_ALL=C
export LC_ALL

emit_docker() {
  command -v docker >/dev/null 2>&1 || return 0
  version="$(docker version --format '{{.Server.Version}}' 2>/dev/null | head -n 1)"
  if [ -z "$version" ]; then
    printf 'ENGINE\tdocker\t\tDocker daemon unavailable\n'
    return 0
  fi
  printf 'ENGINE\tdocker\t%s\t\n' "$version"
  docker ps -a --no-trunc --format '{{json .}}' 2>/dev/null | while IFS= read -r line; do
    printf 'DCONTAINER\tdocker\t%s\n' "$line"
  done
}

emit_podman() {
  command -v podman >/dev/null 2>&1 || return 0
  version="$(podman version --format '{{.Version}}' 2>/dev/null | head -n 1)"
  if [ -z "$version" ]; then
    printf 'ENGINE\tpodman\t\tPodman unavailable\n'
    return 0
  fi
  printf 'ENGINE\tpodman\t%s\t\n' "$version"
  podman ps -a --no-trunc --format '{{json .}}' 2>/dev/null | while IFS= read -r line; do
    printf 'DCONTAINER\tpodman\t%s\n' "$line"
  done
}

emit_containerd() {
  command -v ctr >/dev/null 2>&1 || return 0
  version="$(ctr version 2>/dev/null | sed -n '/^Server:/,/^$/p' | awk '/Version:/ {print $2; exit}')"
  if [ -z "$version" ]; then
    printf 'ENGINE\tcontainerd\t\tcontainerd unavailable\n'
    return 0
  fi
  printf 'ENGINE\tcontainerd\t%s\t\n' "$version"
  ctr namespaces list -q 2>/dev/null | while IFS= read -r namespace; do
    [ -n "$namespace" ] || continue
    ctr --namespace "$namespace" tasks list 2>/dev/null | awk -v ns="$namespace" 'NR > 1 && $1 != "" {printf "CTASK\t%s\t%s\t%s\n", ns, $1, $3}'
    ctr --namespace "$namespace" containers list 2>/dev/null | awk -v ns="$namespace" 'NR > 1 && $1 != "" {printf "CTCONTAINER\t%s\t%s\t%s\n", ns, $1, $2}'
  done
}

emit_docker
emit_podman
emit_containerd`

var (
	containerNamePattern      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
	containerNamespacePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
	containerRestartPattern   = regexp.MustCompile(`^(no|always|unless-stopped|on-failure(:[0-9]+)?)$`)
)

func quoteShellArg(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func joinShellArgs(values []string) string {
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, quoteShellArg(value))
	}
	return strings.Join(quoted, " ")
}

func validateContainerEngine(engine string) error {
	switch engine {
	case model.ContainerEngineDocker, model.ContainerEnginePodman, model.ContainerEngineContainerd:
		return nil
	default:
		return fmt.Errorf("unsupported container engine %q", engine)
	}
}

func validateContainerNamespace(engine, namespace string) (string, error) {
	namespace = strings.TrimSpace(namespace)
	if engine != model.ContainerEngineContainerd {
		return "", nil
	}
	if namespace == "" {
		return "default", nil
	}
	if !containerNamespacePattern.MatchString(namespace) {
		return "", errors.New("invalid containerd namespace")
	}
	return namespace, nil
}

func validateContainerRef(id string) error {
	id = strings.TrimSpace(id)
	if id == "" || len(id) > 512 || strings.HasPrefix(id, "-") || strings.ContainsAny(id, "\x00\r\n") {
		return errors.New("invalid container ID or name")
	}
	return nil
}

func validateContainerName(name string) error {
	if name == "" {
		return nil
	}
	if !containerNamePattern.MatchString(name) {
		return errors.New("invalid container name")
	}
	return nil
}

func normalizeContainerValues(values []string, label string) ([]string, error) {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if len(value) > 4096 || strings.ContainsAny(value, "\x00\r\n") {
			return nil, fmt.Errorf("invalid container %s value", label)
		}
		result = append(result, value)
	}
	return result, nil
}

func buildContainerInspectCommand(engine, namespace, id string) (string, error) {
	if err := validateContainerEngine(engine); err != nil {
		return "", err
	}
	if err := validateContainerRef(id); err != nil {
		return "", err
	}
	namespace, err := validateContainerNamespace(engine, namespace)
	if err != nil {
		return "", err
	}
	if engine == model.ContainerEngineContainerd {
		return joinShellArgs([]string{"ctr", "--namespace", namespace, "containers", "info", strings.TrimSpace(id)}), nil
	}
	return joinShellArgs([]string{engine, "inspect", "--format", "{{json .}}", strings.TrimSpace(id)}), nil
}

func buildContainerActionCommand(request model.ContainerActionRequest) (string, error) {
	if err := validateContainerEngine(request.Engine); err != nil {
		return "", err
	}
	if err := validateContainerRef(request.ID); err != nil {
		return "", err
	}
	namespace, err := validateContainerNamespace(request.Engine, request.Namespace)
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(request.ID)
	if request.Engine != model.ContainerEngineContainerd {
		if request.Action != "start" && request.Action != "stop" && request.Action != "restart" && request.Action != "remove" {
			return "", fmt.Errorf("unsupported container action %q", request.Action)
		}
		command := request.Engine
		if request.Action == "remove" {
			command += " rm"
		} else {
			command += " " + request.Action
		}
		return command + " " + quoteShellArg(id), nil
	}
	prefix := "ctr --namespace " + quoteShellArg(namespace)
	switch request.Action {
	case "start":
		return prefix + " task start -d " + quoteShellArg(id), nil
	case "stop":
		return prefix + " task kill -s SIGTERM " + quoteShellArg(id), nil
	case "restart":
		return prefix + " task kill -s SIGTERM " + quoteShellArg(id) + " >/dev/null 2>&1; " + prefix + " task start -d " + quoteShellArg(id), nil
	case "remove":
		return prefix + " task kill -s SIGKILL " + quoteShellArg(id) + " >/dev/null 2>&1 || true; " + prefix + " task delete " + quoteShellArg(id) + " >/dev/null 2>&1 || true; " + prefix + " container delete " + quoteShellArg(id), nil
	default:
		return "", fmt.Errorf("unsupported container action %q", request.Action)
	}
}

type containerCreateSpec struct {
	engine    string
	namespace string
	image     string
	name      string
	command   []string
	env       []string
	ports     []string
	volumes   []string
	restart   string
}

func buildContainerCreateCommand(request model.ContainerCreateRequest) (string, error) {
	spec, err := validateContainerCreateRequest(request)
	if err != nil {
		return "", err
	}
	if spec.engine == model.ContainerEngineContainerd {
		return buildContainerdCreateCommand(spec), nil
	}
	return buildDockerCreateCommand(spec), nil
}

func validateContainerCreateRequest(request model.ContainerCreateRequest) (containerCreateSpec, error) {
	if err := validateContainerEngine(request.Engine); err != nil {
		return containerCreateSpec{}, err
	}
	namespace, err := validateContainerNamespace(request.Engine, request.Namespace)
	if err != nil {
		return containerCreateSpec{}, err
	}
	if err := validateContainerImage(request.Image); err != nil {
		return containerCreateSpec{}, err
	}
	name := strings.TrimSpace(request.Name)
	if request.Engine == model.ContainerEngineContainerd && name == "" {
		return containerCreateSpec{}, errors.New("container name is required for containerd")
	}
	if err := validateContainerName(name); err != nil {
		return containerCreateSpec{}, err
	}
	env, err := normalizeContainerValues(request.Env, "environment")
	if err != nil {
		return containerCreateSpec{}, err
	}
	ports, err := normalizeContainerValues(request.Ports, "port")
	if err != nil {
		return containerCreateSpec{}, err
	}
	volumes, err := normalizeContainerValues(request.Volumes, "volume")
	if err != nil {
		return containerCreateSpec{}, err
	}
	command, err := normalizeContainerValues(request.Command, "command")
	if err != nil {
		return containerCreateSpec{}, err
	}
	restart := strings.TrimSpace(request.RestartPolicy)
	if restart != "" && !containerRestartPattern.MatchString(restart) {
		return containerCreateSpec{}, errors.New("invalid restart policy")
	}
	if request.Engine == model.ContainerEngineContainerd && (len(ports) > 0 || restart != "") {
		return containerCreateSpec{}, errors.New("containerd create does not support ports or restart policy")
	}
	return containerCreateSpec{
		engine: request.Engine, namespace: namespace, image: strings.TrimSpace(request.Image), name: name,
		command: command, env: env, ports: ports, volumes: volumes, restart: restart,
	}, nil
}

func validateContainerImage(image string) error {
	image = strings.TrimSpace(image)
	if image == "" || len(image) > 512 || strings.HasPrefix(image, "-") || strings.ContainsAny(image, "\x00\r\n") {
		return errors.New("invalid container image")
	}
	return nil
}

func buildDockerCreateCommand(spec containerCreateSpec) string {
	args := []string{spec.engine, "run", "-d"}
	if spec.name != "" {
		args = append(args, "--name", spec.name)
	}
	if spec.restart != "" {
		args = append(args, "--restart", spec.restart)
	}
	args = appendContainerArgs(args, spec.env, "--env")
	args = appendContainerArgs(args, spec.ports, "--publish")
	args = appendContainerArgs(args, spec.volumes, "--volume")
	args = append(args, spec.image)
	args = append(args, spec.command...)
	return joinShellArgs(args)
}

func buildContainerdCreateCommand(spec containerCreateSpec) string {
	args := []string{"ctr", "--namespace", spec.namespace, "run", "-d"}
	args = appendContainerArgs(args, spec.env, "--env")
	args = appendContainerArgs(args, spec.volumes, "--mount")
	args = append(args, spec.image, spec.name)
	args = append(args, spec.command...)
	return joinShellArgs(args)
}

func appendContainerArgs(args, values []string, flag string) []string {
	for _, value := range values {
		args = append(args, flag, value)
	}
	return args
}
