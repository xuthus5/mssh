package service

import (
	"context"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAIAgentBoundedBufferAndContextReader(t *testing.T) {
	buffer := newAIAgentBoundedBuffer(5)
	written, err := buffer.Write([]byte("abc"))
	require.NoError(t, err)
	assert.Equal(t, 3, written)
	written, err = buffer.Write([]byte("defg"))
	require.NoError(t, err)
	assert.Equal(t, 4, written)
	assert.Equal(t, "abcde", buffer.String())
	assert.True(t, buffer.Truncated())

	reader := &contextReader{ctx: context.Background(), reader: strings.NewReader("ok")}
	data, err := io.ReadAll(reader)
	require.NoError(t, err)
	assert.Equal(t, "ok", string(data))
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = (&contextReader{ctx: cancelled, reader: strings.NewReader("late")}).Read(make([]byte, 4))
	assert.ErrorIs(t, err, context.Canceled)
}

func TestAIAgentSFTPAndPathHelpers(t *testing.T) {
	connection := &aiAgentSSH{}
	output, err := connection.executeSFTP(context.Background(), func() (string, error) {
		return "done", nil
	})
	require.NoError(t, err)
	assert.Equal(t, "done", output)
	expectedErr := errors.New("sftp failed")
	_, err = connection.executeSFTP(context.Background(), func() (string, error) {
		return "", expectedErr
	})
	assert.ErrorIs(t, err, expectedErr)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = connection.executeSFTP(cancelled, func() (string, error) {
		return "late", nil
	})
	assert.ErrorIs(t, err, context.Canceled)
	assert.NoError(t, connection.Close())
	assert.NoError(t, (*aiAgentSSH)(nil).Close())

	tempPath, err := aiAgentRemoteTempPath("/var/tmp/config")
	require.NoError(t, err)
	assert.Equal(t, "/var/tmp", filepath.Dir(tempPath))
	assert.Contains(t, filepath.Base(tempPath), ".mssh-agent-")
	assert.True(t, strings.HasSuffix(tempPath, ".tmp"))
	_, err = hex.DecodeString(strings.TrimSuffix(strings.TrimPrefix(filepath.Base(tempPath), ".mssh-agent-"), ".tmp"))
	require.NoError(t, err)

	entries, truncated, err := limitAIAgentDirectoryEntries(nil, 128)
	require.NoError(t, err)
	assert.Empty(t, entries)
	assert.False(t, truncated)
	_, err = connection.Execute(context.Background(), aiAgentToolRequest{Name: "unknown", Timeout: 1})
	assert.ErrorContains(t, err, "unsupported AI agent tool")
}

func TestPrepareAIAgentToolRequestVariants(t *testing.T) {
	security := defaultAISettings().Security
	security.MaxOutputBytes = 4
	tests := []struct {
		name      string
		action    aiAgentAction
		wantName  string
		wantPath  string
		wantError string
	}{
		{name: "list directory", action: aiAgentAction{Tool: "ssh.list_dir", Arguments: []byte(`{"path":" /tmp/../var "}`)}, wantName: "ssh.list_dir", wantPath: "/var"},
		{name: "stat", action: aiAgentAction{Tool: "ssh.stat", Arguments: []byte(`{"path":"/tmp/a"}`)}, wantName: "ssh.stat", wantPath: "/tmp/a"},
		{name: "read file", action: aiAgentAction{Tool: "ssh.read_file", Arguments: []byte(`{"path":"/tmp/a"}`)}, wantName: "ssh.read_file", wantPath: "/tmp/a"},
		{name: "write file", action: aiAgentAction{Tool: "ssh.write_file", Arguments: []byte(`{"path":"/tmp/a","content":"data"}`)}, wantName: "ssh.write_file", wantPath: "/tmp/a"},
		{name: "large write", action: aiAgentAction{Tool: "ssh.write_file", Arguments: []byte(`{"path":"/tmp/a","content":"large"}`)}, wantError: "exceeds"},
		{name: "root path", action: aiAgentAction{Tool: "ssh.stat", Arguments: []byte(`{"path":"/"}`)}, wantError: "root path"},
		{name: "nul path", action: aiAgentAction{Tool: "ssh.stat", Arguments: []byte("{\"path\":\"/tmp/\\u0000a\"}")}, wantError: "required"},
		{name: "unknown", action: aiAgentAction{Tool: "browser", Arguments: []byte(`{}`)}, wantError: "unsupported"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request, err := prepareAIAgentToolRequest(test.action, security)
			if test.wantError != "" {
				assert.ErrorContains(t, err, test.wantError)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, test.wantName, request.Name)
			assert.Equal(t, test.wantPath, request.Path)
		})
	}
}

func TestAIAgentCLIEventScanning(t *testing.T) {
	adapter := claudeAIAgentAdapter{}
	require.NoError(t, scanAIAgentCLIEvents(strings.NewReader("\n{\"type\":\"assistant\"}\n"), adapter, 128))
	assert.ErrorContains(t, scanAIAgentCLIEvents(strings.NewReader(""), adapter, 128), "no JSON events")
	assert.ErrorContains(t, scanAIAgentCLIEvents(strings.NewReader("not-json\n"), adapter, 128), "decode Claude Code event")
	assert.ErrorContains(t, scanAIAgentCLIEvents(strings.NewReader("{\"type\":\"tool_use\",\"name\":\"bash\"}\n"), adapter, 128), "unavailable local tool")
	assert.Equal(t, "trimmed", string(bytesTrimSpace([]byte(" trimmed \n"))))

	token, err := randomAIAgentToken()
	require.NoError(t, err)
	assert.Len(t, token, 64)
	_, err = hex.DecodeString(token)
	require.NoError(t, err)
}

func TestRunAIAgentCLIProcess(t *testing.T) {
	tests := []struct {
		name      string
		script    string
		wantError string
	}{
		{name: "success", script: `printf '{"type":"assistant"}\n'`},
		{name: "invalid event", script: `printf 'bad\n'`, wantError: "decode Claude Code event"},
		{name: "exit error", script: `printf '{"type":"assistant"}\n'; printf 'failed' >&2; exit 7`, wantError: "failed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			process := aiAgentCLIProcess{
				command:        exec.Command("/bin/sh", "-c", test.script),
				adapter:        claudeAIAgentAdapter{},
				maxOutputBytes: 256,
			}
			err := runAIAgentCLIProcess(context.Background(), process)
			if test.wantError == "" {
				require.NoError(t, err)
				return
			}
			assert.ErrorContains(t, err, test.wantError)
		})
	}
}

func TestAIAgentCLICommandConfiguration(t *testing.T) {
	binDir := t.TempDir()
	executable := filepath.Join(binDir, "opencode")
	require.NoError(t, os.WriteFile(executable, []byte("#!/bin/sh\n"), 0o700))
	t.Setenv("PATH", binDir)
	workDir := t.TempDir()
	command, err := (openCodeAIAgentAdapter{}).Command(workDir, "http://127.0.0.1/mcp", "secret", "prompt")
	require.NoError(t, err)
	assert.Equal(t, workDir, command.Dir)
	assert.NotContains(t, strings.Join(command.Args, "\x00"), "secret")
	configPath := filepath.Join(workDir, "opencode.json")
	config, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.Contains(t, string(config), "Bearer secret")
	info, err := os.Stat(configPath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	assert.Contains(t, command.Env, "OPENCODE_CONFIG="+configPath)

	wrapped := commandWithContext(context.Background(), command)
	assert.Equal(t, command.Dir, wrapped.Dir)
	assert.Equal(t, command.Env, wrapped.Env)
	require.NotNil(t, wrapped.SysProcAttr)
	assert.True(t, wrapped.SysProcAttr.Setpgid)
	assert.NotNil(t, wrapped.Cancel)
	assert.ErrorIs(t, killAIAgentProcessGroup(&exec.Cmd{}), os.ErrProcessDone)

	t.Setenv("PATH", t.TempDir())
	_, err = (claudeAIAgentAdapter{}).Command(workDir, "url", "token", "prompt")
	assert.ErrorContains(t, err, "find Claude Code CLI")
	_, err = (openCodeAIAgentAdapter{}).Command(workDir, "url", "token", "prompt")
	assert.ErrorContains(t, err, "find OpenCode CLI")
}
