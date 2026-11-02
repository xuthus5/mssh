package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestBuildDockerRunCommand(t *testing.T) {
	inspect := `{
  "Name": "/web",
  "Image": "sha256:fallback",
  "Config": {
    "Image": "nginx:latest",
    "Env": ["A=1", "B=two words"],
    "Cmd": ["nginx", "-g", "daemon off;"],
    "Entrypoint": ["/entry", "arg1"],
    "WorkingDir": "/app",
    "User": "1000:1000"
  },
  "HostConfig": {
    "PortBindings": {
      "80/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8080"}],
      "443/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8443"}]
    },
    "RestartPolicy": {"Name": "on-failure", "MaximumRetryCount": 3},
    "NetworkMode": "host",
    "AutoRemove": true,
    "Privileged": true,
    "ReadonlyRootfs": true
  },
  "Mounts": [
    {"Type": "volume", "Name": "data", "Source": "/var/lib/docker/volumes/data/_data", "Destination": "/data", "RW": true},
    {"Type": "bind", "Source": "/host", "Destination": "/mnt", "RW": false},
    {"Type": "tmpfs", "Destination": "/tmp", "RW": true},
    {"Type": "bind", "Source": "/ignored", "Destination": "", "RW": true}
  ]
}`
	command, err := buildContainerRunCommand(model.ContainerEngineDocker, "", []byte(inspect))
	require.NoError(t, err)
	assert.Equal(t, "'docker' 'run' '-d' '--name' 'web' '--restart' 'on-failure:3' '--rm' '--privileged' '--read-only' '--network' 'host' '--env' 'A=1' '--env' 'B=two words' '--publish' '127.0.0.1:8443:443/tcp' '--publish' '8080:80/tcp' '--volume' 'data:/data' '--volume' '/host:/mnt:ro' '--tmpfs' '/tmp' '--workdir' '/app' '--user' '1000:1000' '--entrypoint' '/entry' 'nginx:latest' 'arg1' 'nginx' '-g' 'daemon off;'", command)
}

func TestBuildDockerRunCommandFallbacksAndErrors(t *testing.T) {
	command, err := buildContainerRunCommand(model.ContainerEnginePodman, "", []byte(`{"Name":"/job","Image":"sha256:image","Config":{}}`))
	require.NoError(t, err)
	assert.Equal(t, "'podman' 'run' '-d' '--name' 'job' 'sha256:image'", command)

	_, err = buildContainerRunCommand(model.ContainerEngineDocker, "", []byte(`not-json`))
	require.Error(t, err)
	_, err = buildContainerRunCommand(model.ContainerEngineDocker, "", []byte(`{"Name":"/empty"}`))
	require.Error(t, err)
	_, err = buildContainerRunCommand("unknown", "", []byte(`{}`))
	require.Error(t, err)
}

func TestDockerPortArgsHandlesDefaults(t *testing.T) {
	args := dockerPortArgs(map[string][]dockerPortBinding{
		"80":     {{HostPort: "8080"}},
		"53/udp": {{HostIP: "::", HostPort: "5353"}},
	})
	assert.Equal(t, []string{"--publish", "5353:53/udp", "--publish", "8080:80/tcp"}, args)
}

func TestDockerRestartPolicy(t *testing.T) {
	var inspect dockerContainerInspect
	assert.Empty(t, dockerRestartPolicy(inspect))
	inspect.HostConfig.RestartPolicy.Name = "no"
	assert.Empty(t, dockerRestartPolicy(inspect))
	inspect.HostConfig.RestartPolicy.Name = "always"
	assert.Equal(t, "always", dockerRestartPolicy(inspect))
}

func TestBuildContainerdRunCommand(t *testing.T) {
	inspect := `{
  "ID": "ctr-1",
  "Image": "docker.io/library/busybox:latest",
  "Spec": {
    "process": {
      "args": ["sh", "-c", "echo ok"],
      "env": ["A=1", "B=two words"],
      "user": {"uid": 1000, "gid": 1001}
    },
    "mounts": [
      {"destination": "/data", "type": "bind", "source": "/tmp", "options": ["rbind", "ro"]},
      {"destination": ""}
    ]
  }
}`
	command, err := buildContainerRunCommand(model.ContainerEngineContainerd, "k8s.io", []byte(inspect))
	require.NoError(t, err)
	assert.Equal(t, "'ctr' '--namespace' 'k8s.io' 'run' '-d' '--env' 'A=1' '--env' 'B=two words' '--mount' 'type=bind,src=/tmp,dst=/data,options=rbind;ro' '--user' '1000:1001' 'docker.io/library/busybox:latest' 'ctr-1' 'sh' '-c' 'echo ok'", command)

	_, err = buildContainerRunCommand(model.ContainerEngineContainerd, "", []byte(`bad-json`))
	require.Error(t, err)
	_, err = buildContainerRunCommand(model.ContainerEngineContainerd, "", []byte(`{"ID":"","Image":""}`))
	require.Error(t, err)
}
