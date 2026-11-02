package service

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
)

func TestParseContainerOverview(t *testing.T) {
	output := "ENGINE\tdocker\t24.0.7\t\n" +
		"DCONTAINER\tdocker\t{\"ID\":\"abc123456789\",\"Names\":\"web,alias\",\"Image\":\"nginx:latest\",\"State\":\"running\",\"Status\":\"Up 2 hours\",\"Ports\":\"0.0.0.0:8080->80/tcp\"}\n" +
		"DCONTAINER\tpodman\tbroken-json\n" +
		"DCONTAINER\tpodman\t{\"Id\":\"def\",\"Name\":\"api\",\"image\":\"api:v1\",\"state\":\"Exited\",\"status\":\"Exited (0)\"}\n" +
		"ENGINE\tpodman\t\tPodman unavailable\n" +
		"ENGINE\t\t\tmissing engine\n" +
		"ENGINE\tbroken\n" +
		"ENGINE\tcontainerd\tv1.7.0\t\n" +
		"CTASK\tdefault\tctr-b\tRUNNING\n" +
		"CTCONTAINER\tdefault\tctr-b\tdocker.io/library/busybox:latest\n" +
		"CTCONTAINER\tdefault\tctr-a\tdocker.io/library/alpine:latest\n" +
		"unknown\n" +
		"\n"
	overview := parseContainerOverview(output)
	require.Len(t, overview.Engines, 3)
	assert.Equal(t, model.ContainerEngineInfo{Name: "docker", Version: "24.0.7", Available: true}, overview.Engines[0])
	assert.False(t, overview.Engines[1].Available)
	assert.Equal(t, "Podman unavailable", overview.Engines[1].Error)
	assert.Equal(t, "containerd", overview.Engines[2].Name)
	require.Len(t, overview.Containers, 4)
	assert.Equal(t, "ctr-a", overview.Containers[0].Name)
	assert.Equal(t, "stopped", overview.Containers[0].State)
	assert.Equal(t, "ctr-b", overview.Containers[1].Name)
	assert.Equal(t, "running", overview.Containers[1].State)
	assert.Equal(t, "RUNNING", overview.Containers[1].Status)
	assert.Equal(t, "abc123456789", overview.Containers[2].ID)
	assert.Equal(t, "web", overview.Containers[2].Name)
	assert.Equal(t, "running", overview.Containers[2].State)
	assert.Equal(t, model.ContainerInfo{ID: "def", Name: "api", Engine: "podman", Image: "api:v1", State: "exited", Status: "Exited (0)"}, overview.Containers[3])
}

func TestContainerServiceOperations(t *testing.T) {
	restoreProbe, restoreRead, restoreMutation := installContainerProbeStubs(t)
	defer restoreProbe()
	defer restoreRead()
	defer restoreMutation()
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	service.sessionIDs["term-1"] = 1
	var commands []string
	_runContainerReadCommand = func(_ *ssh.ClientWrapper, command string) ([]byte, error) {
		commands = append(commands, command)
		if command == containerOverviewCommand {
			return []byte("ENGINE\tdocker\t24\t\nDCONTAINER\tdocker\t{\"ID\":\"abc\",\"Names\":\"web\",\"Image\":\"nginx\",\"State\":\"running\"}\n"), nil
		}
		return []byte(`{"ID":"ctr-1","Image":"busybox","Spec":{"process":{"args":["sh"]}}}`), nil
	}
	_runContainerMutationCommand = func(_ *ssh.ClientWrapper, command string) ([]byte, error) {
		commands = append(commands, command)
		return []byte("ok"), nil
	}

	overview, err := service.ContainerOverview("term-1")
	require.NoError(t, err)
	require.Len(t, overview.Containers, 1)
	assert.Equal(t, "web", overview.Containers[0].Name)

	command, err := service.ContainerRunCommand("term-1", "containerd", "default", "ctr-1")
	require.NoError(t, err)
	assert.Equal(t, "'ctr' '--namespace' 'default' 'run' '-d' 'busybox' 'ctr-1' 'sh'", command)

	require.NoError(t, service.ContainerAction("term-1", model.ContainerActionRequest{Engine: "docker", ID: "abc", Action: "start"}))
	require.NoError(t, service.CreateContainer("term-1", model.ContainerCreateRequest{Engine: "docker", Image: "busybox", Name: "job"}))
	assert.Len(t, commands, 4)
}

func TestContainerServiceErrors(t *testing.T) {
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	_, err := service.ContainerOverview("")
	require.Error(t, err)
	_, err = service.ContainerOverview("missing")
	require.ErrorContains(t, err, "not found")
	require.Error(t, service.ContainerAction("", model.ContainerActionRequest{Engine: "docker", ID: "abc", Action: "start"}))
	_, err = service.ContainerRunCommand("", "invalid", "", "abc")
	require.Error(t, err)

	restoreProbe := installProbeOpenError(t, errors.New("probe connection failed"))
	defer restoreProbe()
	service.sessionIDs["term-1"] = 1
	_, err = service.ContainerOverview("term-1")
	require.ErrorContains(t, err, "probe connection failed")
}

func TestContainerServiceRunnerError(t *testing.T) {
	restoreProbe, restoreRead, restoreMutation := installContainerProbeStubs(t)
	defer restoreProbe()
	defer restoreRead()
	defer restoreMutation()
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	service.sessionIDs["term-1"] = 1
	_runContainerReadCommand = func(*ssh.ClientWrapper, string) ([]byte, error) { return nil, errors.New("read failed") }
	_runContainerMutationCommand = func(*ssh.ClientWrapper, string) ([]byte, error) { return nil, errors.New("write failed") }

	_, err := service.ContainerOverview("term-1")
	require.ErrorContains(t, err, "read failed")
	_, err = service.ContainerRunCommand("term-1", "docker", "", "abc")
	require.ErrorContains(t, err, "read failed")
	require.ErrorContains(t, service.ContainerAction("term-1", model.ContainerActionRequest{Engine: "docker", ID: "abc", Action: "stop"}), "write failed")
	require.ErrorContains(t, service.CreateContainer("term-1", model.ContainerCreateRequest{Engine: "docker", Image: "busybox", Name: "job"}), "write failed")
}

func TestContainerServiceRejectsInvalidRequestsBeforeProbe(t *testing.T) {
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	service.sessionIDs["term-1"] = 1
	require.Error(t, service.ContainerAction("term-1", model.ContainerActionRequest{Engine: "docker", Action: "start"}))
	require.Error(t, service.CreateContainer("term-1", model.ContainerCreateRequest{Engine: "docker"}))
	_, err := service.ContainerRunCommand("term-1", "docker", "", "-bad")
	require.Error(t, err)
}

func TestRunContainerCommandsRequireSSHClient(t *testing.T) {
	_, err := runContainerReadCommand(nil, "list")
	require.Error(t, err)
	_, err = runContainerMutationCommand(nil, "start")
	require.Error(t, err)
}

func installContainerProbeStubs(t *testing.T) (func(), func(), func()) {
	t.Helper()
	originalProbe := _openSystemProbeConnection
	originalRead := _runContainerReadCommand
	originalMutation := _runContainerMutationCommand
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return &ssh.ClientWrapper{}, func() {}, nil
	}
	return func() { _openSystemProbeConnection = originalProbe }, func() { _runContainerReadCommand = originalRead }, func() { _runContainerMutationCommand = originalMutation }
}

func installProbeOpenError(t *testing.T, target error) func() {
	t.Helper()
	original := _openSystemProbeConnection
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return nil, nil, target
	}
	return func() { _openSystemProbeConnection = original }
}
