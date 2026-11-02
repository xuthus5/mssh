package service

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
	ssh "github.com/xuthus5/mssh/internal/ssh"
)

var (
	_runContainerReadCommand     = runContainerReadCommand
	_runContainerMutationCommand = runContainerMutationCommand
)

type containerProbeRunner func(*ssh.ClientWrapper, string) ([]byte, error)

type containerdContainerRow struct {
	namespace string
	name      string
	image     string
}

func (t *TerminalService) executeContainerProbe(terminalID, command string, runner containerProbeRunner) ([]byte, error) {
	if err := validateTerminalID(terminalID); err != nil {
		return nil, err
	}
	finish, err := t.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	sessionID, ok := t.terminalSessionID(terminalID)
	if !ok {
		return nil, fmt.Errorf("terminal %s not found", terminalID)
	}
	wrapper, release, err := t.acquireSystemProbeConnection(sessionID)
	if err != nil {
		return nil, err
	}
	defer release()
	return runner(wrapper, command)
}

func (t *TerminalService) ContainerOverview(terminalID string) (*model.ContainerOverview, error) {
	output, err := t.executeContainerProbe(terminalID, containerOverviewCommand, _runContainerReadCommand)
	if err != nil {
		return nil, err
	}
	return parseContainerOverview(string(output)), nil
}

func (t *TerminalService) ContainerRunCommand(terminalID, engine, namespace, id string) (string, error) {
	command, err := buildContainerInspectCommand(engine, namespace, id)
	if err != nil {
		return "", err
	}
	output, err := t.executeContainerProbe(terminalID, command, _runContainerReadCommand)
	if err != nil {
		return "", err
	}
	return buildContainerRunCommand(engine, namespace, output)
}

func (t *TerminalService) ContainerAction(terminalID string, request model.ContainerActionRequest) error {
	command, err := buildContainerActionCommand(request)
	if err != nil {
		return err
	}
	_, err = t.executeContainerProbe(terminalID, command, _runContainerMutationCommand)
	return err
}

func (t *TerminalService) CreateContainer(terminalID string, request model.ContainerCreateRequest) error {
	command, err := buildContainerCreateCommand(request)
	if err != nil {
		return err
	}
	_, err = t.executeContainerProbe(terminalID, command, _runContainerMutationCommand)
	return err
}

func parseContainerOverview(output string) *model.ContainerOverview {
	overview := &model.ContainerOverview{
		Engines:    make([]model.ContainerEngineInfo, 0),
		Containers: make([]model.ContainerInfo, 0),
	}
	tasks := make(map[string]string)
	containerdRows := make([]containerdContainerRow, 0)
	for _, line := range strings.Split(output, "\n") {
		parseContainerOverviewLine(line, overview, tasks, &containerdRows)
	}
	for _, row := range containerdRows {
		state := tasks[row.namespace+"\x00"+row.name]
		if state == "" {
			state = "STOPPED"
		}
		overview.Containers = append(overview.Containers, model.ContainerInfo{
			ID: row.name, Name: row.name, Engine: model.ContainerEngineContainerd, Namespace: row.namespace,
			Image: row.image, State: strings.ToLower(state), Status: state,
		})
	}
	sort.SliceStable(overview.Containers, func(left, right int) bool {
		if overview.Containers[left].Engine != overview.Containers[right].Engine {
			return overview.Containers[left].Engine < overview.Containers[right].Engine
		}
		return overview.Containers[left].Name < overview.Containers[right].Name
	})
	return overview
}

func parseContainerOverviewLine(line string, overview *model.ContainerOverview, tasks map[string]string, rows *[]containerdContainerRow) {
	fields := strings.Split(strings.TrimSuffix(line, "\r"), "\t")
	if len(fields) < 2 {
		return
	}
	switch fields[0] {
	case "ENGINE":
		appendContainerEngine(overview, fields)
	case "DCONTAINER":
		appendDockerContainer(overview, fields)
	case "CTCONTAINER":
		if len(fields) >= 4 {
			*rows = append(*rows, containerdContainerRow{namespace: fields[1], name: fields[2], image: fields[3]})
		}
	case "CTASK":
		if len(fields) >= 4 {
			tasks[fields[1]+"\x00"+fields[2]] = fields[3]
		}
	}
}

func appendContainerEngine(overview *model.ContainerOverview, fields []string) {
	if len(fields) < 4 || strings.TrimSpace(fields[1]) == "" {
		return
	}
	version := strings.TrimSpace(fields[2])
	overview.Engines = append(overview.Engines, model.ContainerEngineInfo{
		Name: fields[1], Version: version, Available: version != "", Error: strings.TrimSpace(fields[3]),
	})
}

func appendDockerContainer(overview *model.ContainerOverview, fields []string) {
	if len(fields) < 3 {
		return
	}
	if container, ok := parseDockerContainer(fields[2], fields[1]); ok {
		overview.Containers = append(overview.Containers, container)
	}
}

func parseDockerContainer(line, engine string) (model.ContainerInfo, bool) {
	var values map[string]any
	if err := json.Unmarshal([]byte(line), &values); err != nil {
		return model.ContainerInfo{}, false
	}
	id := firstContainerJSONString(values, "ID", "Id", "id")
	name := firstContainerJSONString(values, "Names", "Name", "names", "name")
	if id == "" && name == "" {
		return model.ContainerInfo{}, false
	}
	state := firstContainerJSONString(values, "State", "state")
	status := firstContainerJSONString(values, "Status", "status")
	return model.ContainerInfo{
		ID: id, Name: firstContainerName(name), Engine: engine,
		Image: firstContainerJSONString(values, "Image", "image"), State: strings.ToLower(state),
		Status: status, Ports: firstContainerJSONString(values, "Ports", "ports"),
	}, true
}

func firstContainerJSONString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key].(string); ok {
			return value
		}
	}
	return ""
}

func firstContainerName(names string) string {
	return strings.TrimSpace(strings.Split(names, ",")[0])
}
