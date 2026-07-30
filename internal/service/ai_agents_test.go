package service

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDetectAICLI(t *testing.T) {
	directory := t.TempDir()
	path := installAIAgentTestLauncher(t, directory, "agent-test", "TestAIAgentVersionHelperProcess")
	t.Setenv("MSSH_AGENT_VERSION_HELPER", "success")
	setAIAgentTestPath(t, directory)
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
	installAIAgentTestLauncher(t, directory, "agent-fail", "TestAIAgentVersionHelperProcess")
	t.Setenv("MSSH_AGENT_VERSION_HELPER", "failure")
	setAIAgentTestPath(t, directory)
	status := detectAICLI("Agent Fail", "agent-fail")
	assert.True(t, status.Installed)
	assert.Contains(t, status.Error, "读取版本失败")
}

func TestDetectAICLIRejectsOversizedVersionOutput(t *testing.T) {
	directory := t.TempDir()
	installAIAgentTestLauncher(t, directory, "agent-large", "TestAIAgentVersionHelperProcess")
	t.Setenv("MSSH_AGENT_VERSION_HELPER", "oversized")
	setAIAgentTestPath(t, directory)

	status := detectAICLI("Agent Large", "agent-large")

	assert.True(t, status.Installed)
	assert.Contains(t, status.Error, "输出过大")
	assert.Empty(t, status.Version)
}

func TestAIAgentVersionHelperProcess(t *testing.T) {
	switch os.Getenv("MSSH_AGENT_VERSION_HELPER") {
	case "":
		return
	case "success":
		_, _ = fmt.Println("agent-test 1.2.3")
		os.Exit(0)
	case "failure":
		os.Exit(1)
	case "oversized":
		_, _ = fmt.Print(strings.Repeat("0", maxAIAgentVersionOutputBytes+1))
		os.Exit(0)
	default:
		os.Exit(2)
	}
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
