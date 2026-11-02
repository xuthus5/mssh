package service

import (
	"os/exec"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestQuoteShellArg(t *testing.T) {
	assert.Equal(t, "'plain'", quoteShellArg("plain"))
	assert.Equal(t, `'a'"'"'b'`, quoteShellArg("a'b"))
	assert.Equal(t, "'a b'", quoteShellArg("a b"))
}

func TestContainerOverviewCommandHasValidShellSyntax(t *testing.T) {
	require.NoError(t, exec.Command("sh", "-n", "-c", containerOverviewCommand).Run())
}

func TestBuildContainerInspectCommand(t *testing.T) {
	command, err := buildContainerInspectCommand(model.ContainerEngineDocker, "", "abc123")
	require.NoError(t, err)
	assert.Equal(t, "'docker' 'inspect' '--format' '{{json .}}' 'abc123'", command)

	command, err = buildContainerInspectCommand(model.ContainerEngineContainerd, "k8s.io", "ctr-1")
	require.NoError(t, err)
	assert.Equal(t, "'ctr' '--namespace' 'k8s.io' 'containers' 'info' 'ctr-1'", command)

	_, err = buildContainerInspectCommand("unknown", "default", "id")
	require.Error(t, err)
	_, err = buildContainerInspectCommand(model.ContainerEngineDocker, "", "-bad")
	require.Error(t, err)
	_, err = buildContainerInspectCommand(model.ContainerEngineContainerd, "bad namespace", "id")
	require.Error(t, err)
}

func TestBuildContainerActionCommand(t *testing.T) {
	tests := []struct {
		name     string
		request  model.ContainerActionRequest
		expected string
	}{
		{name: "docker start", request: model.ContainerActionRequest{Engine: "docker", ID: "abc", Action: "start"}, expected: "docker start 'abc'"},
		{name: "podman stop", request: model.ContainerActionRequest{Engine: "podman", ID: "abc", Action: "stop"}, expected: "podman stop 'abc'"},
		{name: "docker restart", request: model.ContainerActionRequest{Engine: "docker", ID: "abc", Action: "restart"}, expected: "docker restart 'abc'"},
		{name: "podman remove", request: model.ContainerActionRequest{Engine: "podman", ID: "abc", Action: "remove"}, expected: "podman rm 'abc'"},
		{name: "containerd start", request: model.ContainerActionRequest{Engine: "containerd", Namespace: "k8s.io", ID: "ctr", Action: "start"}, expected: "ctr --namespace 'k8s.io' task start -d 'ctr'"},
		{name: "containerd stop", request: model.ContainerActionRequest{Engine: "containerd", ID: "ctr", Action: "stop"}, expected: "ctr --namespace 'default' task kill -s SIGTERM 'ctr'"},
		{name: "containerd restart", request: model.ContainerActionRequest{Engine: "containerd", ID: "ctr", Action: "restart"}, expected: "ctr --namespace 'default' task kill -s SIGTERM 'ctr' >/dev/null 2>&1; ctr --namespace 'default' task start -d 'ctr'"},
		{name: "containerd remove", request: model.ContainerActionRequest{Engine: "containerd", ID: "ctr", Action: "remove"}, expected: "ctr --namespace 'default' task kill -s SIGKILL 'ctr' >/dev/null 2>&1 || true; ctr --namespace 'default' task delete 'ctr' >/dev/null 2>&1 || true; ctr --namespace 'default' container delete 'ctr'"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			command, err := buildContainerActionCommand(test.request)
			require.NoError(t, err)
			assert.Equal(t, test.expected, command)
		})
	}

	_, err := buildContainerActionCommand(model.ContainerActionRequest{Engine: "docker", ID: "", Action: "start"})
	require.Error(t, err)
	_, err = buildContainerActionCommand(model.ContainerActionRequest{Engine: "docker", ID: "abc", Action: "pause"})
	require.Error(t, err)
	_, err = buildContainerActionCommand(model.ContainerActionRequest{Engine: "containerd", ID: "abc", Action: "pause"})
	require.Error(t, err)
	_, err = buildContainerActionCommand(model.ContainerActionRequest{Engine: "unknown", ID: "abc", Action: "start"})
	require.Error(t, err)
}

func TestBuildContainerCreateCommandDocker(t *testing.T) {
	command, err := buildContainerCreateCommand(model.ContainerCreateRequest{
		Engine: "docker", Image: "nginx:latest", Name: "web", RestartPolicy: "unless-stopped",
		Env: []string{"A=1", " "}, Ports: []string{"8080:80"}, Volumes: []string{"/data:/data"},
		Command: []string{"nginx", "-g", "daemon off;"},
	})
	require.NoError(t, err)
	assert.Equal(t, "'docker' 'run' '-d' '--name' 'web' '--restart' 'unless-stopped' '--env' 'A=1' '--publish' '8080:80' '--volume' '/data:/data' 'nginx:latest' 'nginx' '-g' 'daemon off;'", command)
}

func TestBuildContainerCreateCommandContainerd(t *testing.T) {
	command, err := buildContainerCreateCommand(model.ContainerCreateRequest{
		Engine: "containerd", Namespace: "k8s.io", Image: "docker.io/library/busybox:latest", Name: "job",
		Env: []string{"A=1"}, Volumes: []string{"type=bind,src=/tmp,dst=/data"}, Command: []string{"sh", "-c", "echo ok"},
	})
	require.NoError(t, err)
	assert.Equal(t, "'ctr' '--namespace' 'k8s.io' 'run' '-d' '--env' 'A=1' '--mount' 'type=bind,src=/tmp,dst=/data' 'docker.io/library/busybox:latest' 'job' 'sh' '-c' 'echo ok'", command)
}

func TestBuildContainerCreateCommandValidation(t *testing.T) {
	tests := []model.ContainerCreateRequest{
		{Engine: "unknown", Image: "busybox", Name: "job"},
		{Engine: "docker", Image: "", Name: "job"},
		{Engine: "docker", Image: "-bad", Name: "job"},
		{Engine: "docker", Image: "busybox", Name: "bad name"},
		{Engine: "containerd", Image: "busybox", Name: ""},
		{Engine: "containerd", Image: "busybox", Name: "job", Ports: []string{"8080:80"}},
		{Engine: "containerd", Image: "busybox", Name: "job", RestartPolicy: "always"},
		{Engine: "docker", Image: "busybox", Name: "job", RestartPolicy: "sometimes"},
		{Engine: "docker", Image: "busybox", Name: "job", Env: []string{strings.Repeat("x", 4097)}},
		{Engine: "docker", Image: "busybox", Name: "job", Env: []string{"A=1\nB=2"}},
		{Engine: "containerd", Image: "busybox", Name: "job", Namespace: "bad namespace"},
	}
	for _, request := range tests {
		_, err := buildContainerCreateCommand(request)
		assert.Error(t, err, "%+v", request)
	}
}

func TestNormalizeContainerValues(t *testing.T) {
	values, err := normalizeContainerValues([]string{" one ", "", "two"}, "environment")
	require.NoError(t, err)
	assert.Equal(t, []string{"one", "two"}, values)
}
