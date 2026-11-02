package service

import (
	"errors"
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
)

func TestListeningPortsCommandHasValidShellSyntax(t *testing.T) {
	require.NoError(t, exec.Command("sh", "-n", "-c", listeningPortsCommand).Run())
}

func TestParseListeningPorts(t *testing.T) {
	output := "PORT\ttcp\t0.0.0.0:22\tusers:((\"sshd\",pid=123,fd=3))\r\n" +
		"PORT\ttcp\t[::]:443\tusers:((\"nginx\",pid=456,fd=6))\n" +
		"PORT\tudp\t127.0.0.53%lo:53\tusers:((\"systemd-resolve\",pid=654,fd=13))\n" +
		"PORT\ttcp6\t:::8080\t123/java\n" +
		"PORT\ttcp\t127.0.0.1:9000\t\n" +
		"PORT\tsctp\t0.0.0.0:1\t\n" +
		"PORT\ttcp\tinvalid\t\n"
	ports := parseListeningPorts(output)
	require.Equal(t, []model.ListeningPortInfo{
		{Protocol: "tcp", Address: "0.0.0.0", Port: 22, PID: 123, ProcessName: "sshd"},
		{Protocol: "udp", Address: "127.0.0.53%lo", Port: 53, PID: 654, ProcessName: "systemd-resolve"},
		{Protocol: "tcp", Address: "::", Port: 443, PID: 456, ProcessName: "nginx"},
		{Protocol: "tcp6", Address: "::", Port: 8080, PID: 123, ProcessName: "java"},
		{Protocol: "tcp", Address: "127.0.0.1", Port: 9000, PID: 0, ProcessName: ""},
	}, ports)
}

func TestSplitListeningAddress(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		address string
		port    int
		ok      bool
	}{
		{name: "IPv4", value: "0.0.0.0:22", address: "0.0.0.0", port: 22, ok: true},
		{name: "IPv6 bracket", value: "[::]:443", address: "::", port: 443, ok: true},
		{name: "IPv6 zone", value: "[fe80::1%eth0]:80", address: "fe80::1%eth0", port: 80, ok: true},
		{name: "IPv6 netstat", value: ":::8080", address: "::", port: 8080, ok: true},
		{name: "IPv6 unbracketed", value: "::1:8443", address: "::1", port: 8443, ok: true},
		{name: "wildcard", value: "*:53", address: "*", port: 53, ok: true},
		{name: "empty", value: ""},
		{name: "missing port", value: "127.0.0.1"},
		{name: "empty host", value: ":80"},
		{name: "empty port", value: "127.0.0.1:"},
		{name: "missing separator", value: "[::]80"},
		{name: "empty IPv6", value: "[]:80"},
		{name: "port too large", value: "127.0.0.1:70000"},
		{name: "non numeric port", value: "127.0.0.1:http"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			address, port, ok := splitListeningAddress(test.value)
			assert.Equal(t, test.ok, ok)
			assert.Equal(t, test.address, address)
			assert.Equal(t, test.port, port)
		})
	}
}

func TestParseListeningProcess(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		pid     int64
		process string
	}{
		{name: "ss", value: `users:(("sshd",pid=123,fd=3))`, pid: 123, process: "sshd"},
		{name: "ss spaced", value: `users:(("nginx", pid=456, fd=6))`, pid: 456, process: "nginx"},
		{name: "netstat", value: "789/dockerd", pid: 789, process: "dockerd"},
		{name: "netstat spaced", value: "790/Google Chrome", pid: 790, process: "Google Chrome"},
		{name: "empty", value: ""},
		{name: "unknown", value: "not available"},
		{name: "invalid pid", value: "invalid/process"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pid, process := parseListeningProcess(test.value)
			assert.Equal(t, test.pid, pid)
			assert.Equal(t, test.process, process)
		})
	}
}

func TestTerminalServiceListeningPorts(t *testing.T) {
	originalCommand := _runSystemInfoCommand
	originalProbe := _openSystemProbeConnection
	t.Cleanup(func() {
		_runSystemInfoCommand = originalCommand
		_openSystemProbeConnection = originalProbe
	})
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, command string) ([]byte, error) {
		require.Equal(t, listeningPortsCommand, command)
		return []byte("PORT\ttcp\t0.0.0.0:22\tusers:((\"sshd\",pid=123,fd=3))\n"), nil
	}
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return &ssh.ClientWrapper{}, func() {}, nil
	}
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	service.sessionIDs["term-1"] = 1

	ports, err := service.ListeningPorts("term-1")
	require.NoError(t, err)
	require.Len(t, ports, 1)
	assert.Equal(t, int64(123), ports[0].PID)
	assert.Equal(t, "sshd", ports[0].ProcessName)
}

func TestTerminalServiceListeningPortsErrors(t *testing.T) {
	originalCommand := _runSystemInfoCommand
	originalProbe := _openSystemProbeConnection
	t.Cleanup(func() {
		_runSystemInfoCommand = originalCommand
		_openSystemProbeConnection = originalProbe
	})
	service := NewTerminalService(&SessionService{}, newMockEventBus(), 2, testutil.NewTestLogger())
	_, err := service.ListeningPorts("missing")
	require.ErrorContains(t, err, "terminal missing not found")

	service.sessionIDs["term-1"] = 1
	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return nil, nil, errors.New("probe connection failed")
	}
	_, err = service.ListeningPorts("term-1")
	require.ErrorContains(t, err, "probe connection failed")

	_openSystemProbeConnection = func(_ *SessionService, _ int64) (*ssh.ClientWrapper, func(), error) {
		return &ssh.ClientWrapper{}, func() {}, nil
	}
	_runSystemInfoCommand = func(_ *ssh.ClientWrapper, _ string) ([]byte, error) {
		return nil, errors.New("listener probe failed")
	}
	_, err = service.ListeningPorts("term-1")
	require.ErrorContains(t, err, "listener probe failed")
}

func TestListeningPortsRejectsEmptyTerminalID(t *testing.T) {
	svc := &TerminalService{logger: testutil.NewTestLogger(), connIDs: map[string]string{}}
	_, err := svc.ListeningPorts("")
	require.ErrorContains(t, err, "invalid terminal id")
}
