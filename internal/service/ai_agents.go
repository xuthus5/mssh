package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

var aiCLIs = []struct {
	name    string
	command string
}{
	{name: "Codex", command: "codex"},
	{name: "Claude Code", command: "claude"},
	{name: "OpenCode", command: "opencode"},
}

var errAIAgentVersionOutputTooLarge = errors.New("AI CLI version output is too large")

func (s *AIService) DetectAgentCLIs() []model.AIAgentCLIStatus {
	operationContext, finish, err := s.beginOperation()
	if err != nil {
		return []model.AIAgentCLIStatus{}
	}
	defer finish()
	result := make([]model.AIAgentCLIStatus, 0, len(aiCLIs))
	for _, cli := range aiCLIs {
		if operationContext.Err() != nil {
			break
		}
		result = append(result, detectAICLIContext(operationContext, cli.name, cli.command))
	}
	return result
}

func detectAICLI(name, command string) model.AIAgentCLIStatus {
	return detectAICLIContext(context.Background(), name, command)
}

func detectAICLIContext(ctx context.Context, name, command string) model.AIAgentCLIStatus {
	status := model.AIAgentCLIStatus{Name: name, Command: command, DetectedAt: time.Now()}
	path, err := exec.LookPath(command)
	if err != nil {
		status.Error = "未找到可执行文件"
		return status
	}
	status.Path = path
	status.Installed = true
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	output, err := readAICLIVersion(ctx, path)
	if err != nil {
		if errors.Is(err, errAIAgentVersionOutputTooLarge) {
			status.Error = fmt.Sprintf("读取版本失败: 输出过大（最多 %d 字节）", maxAIAgentVersionOutputBytes)
			return status
		}
		status.Error = fmt.Sprintf("读取版本失败: %v", err)
		return status
	}
	status.Version = strings.TrimSpace(output)
	return status
}

func readAICLIVersion(ctx context.Context, path string) (string, error) {
	output := boundedAIVersionOutput{maxBytes: maxAIAgentVersionOutputBytes}
	// #nosec G204 -- path is resolved by exec.LookPath from the fixed aiCLIs command allowlist.
	command := exec.CommandContext(ctx, path, "--version")
	command.Stdout = &output
	runErr := command.Run()
	if output.exceeded {
		return "", errAIAgentVersionOutputTooLarge
	}
	if runErr != nil {
		return "", runErr
	}
	return output.buffer.String(), nil
}

type boundedAIVersionOutput struct {
	buffer   bytes.Buffer
	maxBytes int
	exceeded bool
}

func (output *boundedAIVersionOutput) Write(content []byte) (int, error) {
	originalLength := len(content)
	remaining := max(output.maxBytes-output.buffer.Len(), 0)
	if len(content) > remaining {
		content = content[:remaining]
		output.exceeded = true
	}
	if len(content) > 0 {
		if _, err := output.buffer.Write(content); err != nil {
			return 0, err
		}
	}
	return originalLength, nil
}
