package service

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDetectAICLI(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "agent-test")
	require.NoError(t, os.WriteFile(path, []byte("#!/bin/sh\necho agent-test 1.2.3\n"), 0o700))
	t.Setenv("PATH", directory)
	status := detectAICLI("Agent Test", "agent-test")
	assert.True(t, status.Installed)
	assert.Equal(t, path, status.Path)
	assert.Equal(t, "agent-test 1.2.3", status.Version)
	missing := detectAICLI("Missing", "missing-agent")
	assert.False(t, missing.Installed)
	assert.NotEmpty(t, missing.Error)
}

func TestDetectAgentCLIsReturnsConfiguredCommands(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	service := &AIService{}
	statuses := service.DetectAgentCLIs()
	require.Len(t, statuses, 3)
	assert.Equal(t, []string{"codex", "claude", "opencode"}, []string{statuses[0].Command, statuses[1].Command, statuses[2].Command})
}

func TestDetectAICLIReportsVersionFailure(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "agent-fail")
	require.NoError(t, os.WriteFile(path, []byte("#!/bin/sh\nexit 1\n"), 0o700))
	t.Setenv("PATH", directory)
	status := detectAICLI("Agent Fail", "agent-fail")
	assert.True(t, status.Installed)
	assert.Contains(t, status.Error, "读取版本失败")
}

func TestDetectAICLIRejectsOversizedVersionOutput(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is Unix-specific")
	}
	directory := t.TempDir()
	path := filepath.Join(directory, "agent-large")
	script := "#!/bin/sh\nprintf '%0" + strconv.Itoa(maxAIAgentVersionOutputBytes+1) + "d' 0\n"
	require.NoError(t, os.WriteFile(path, []byte(script), 0o700))
	t.Setenv("PATH", directory)

	status := detectAICLI("Agent Large", "agent-large")

	assert.True(t, status.Installed)
	assert.Contains(t, status.Error, "输出过大")
	assert.Empty(t, status.Version)
}

func TestBoundedAIVersionOutputKeepsOnlyConfiguredBytes(t *testing.T) {
	output := boundedAIVersionOutput{maxBytes: 4}

	written, err := output.Write([]byte("ab"))
	require.NoError(t, err)
	assert.Equal(t, 2, written)
	written, err = output.Write([]byte("cdef"))
	require.NoError(t, err)
	assert.Equal(t, 4, written)

	assert.Equal(t, "abcd", output.buffer.String())
	assert.True(t, output.exceeded)
}
