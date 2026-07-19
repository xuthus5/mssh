package service

import (
	"context"
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

func (s *AIService) DetectAgentCLIs() []model.AIAgentCLIStatus {
	result := make([]model.AIAgentCLIStatus, 0, len(aiCLIs))
	for _, cli := range aiCLIs {
		result = append(result, detectAICLI(cli.name, cli.command))
	}
	return result
}

func detectAICLI(name, command string) model.AIAgentCLIStatus {
	status := model.AIAgentCLIStatus{Name: name, Command: command, DetectedAt: time.Now()}
	path, err := exec.LookPath(command)
	if err != nil {
		status.Error = "未找到可执行文件"
		return status
	}
	status.Path = path
	status.Installed = true
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, "--version").Output()
	if err != nil {
		status.Error = fmt.Sprintf("读取版本失败: %v", err)
		return status
	}
	status.Version = strings.TrimSpace(string(output))
	return status
}
