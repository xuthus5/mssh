package service

import (
	"encoding/json"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

type aiAgentToolSpec struct {
	Name        string
	Description string
	Properties  map[string]any
	Required    []string
}

func agentOpenAIMessages(input aiChatInput) []map[string]string {
	return []map[string]string{{"role": "system", "content": input.System}, {"role": "user", "content": input.Prompt}}
}

func agentMaxTokens(profile model.AIProviderProfile) int {
	if profile.MaxTokens > 0 {
		return profile.MaxTokens
	}
	return 4096
}

func agentAnthropicText(content []struct {
	Type  string          `json:"type"`
	Text  string          `json:"text"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}) string {
	parts := make([]string, 0, len(content))
	for _, item := range content {
		if item.Type == "text" && item.Text != "" {
			parts = append(parts, item.Text)
		}
	}
	return strings.Join(parts, "\n")
}

func agentGeminiText(parts []struct {
	Text         string `json:"text"`
	FunctionCall *struct {
		Name string          `json:"name"`
		Args json.RawMessage `json:"args"`
	} `json:"functionCall"`
}) string {
	text := make([]string, 0, len(parts))
	for _, part := range parts {
		if part.Text != "" {
			text = append(text, part.Text)
		}
	}
	return strings.Join(text, "\n")
}

func openAIAgentTools() []map[string]any {
	tools := make([]map[string]any, 0, len(aiAgentToolSpecs()))
	for _, spec := range aiAgentToolSpecs() {
		function := map[string]any{"name": spec.Name, "description": spec.Description, "parameters": agentToolSchema(spec)}
		tools = append(tools, map[string]any{"type": "function", "function": function})
	}
	return tools
}

func anthropicAIAgentTools() []map[string]any {
	tools := make([]map[string]any, 0, len(aiAgentToolSpecs()))
	for _, spec := range aiAgentToolSpecs() {
		tools = append(tools, map[string]any{"name": spec.Name, "description": spec.Description, "input_schema": agentToolSchema(spec)})
	}
	return tools
}

func geminiAIAgentTools() []map[string]any {
	tools := make([]map[string]any, 0, len(aiAgentToolSpecs()))
	for _, spec := range aiAgentToolSpecs() {
		tools = append(tools, map[string]any{"name": spec.Name, "description": spec.Description, "parameters": agentToolSchema(spec)})
	}
	return tools
}

func agentToolSchema(spec aiAgentToolSpec) map[string]any {
	return map[string]any{"type": "object", "properties": spec.Properties, "required": spec.Required, "additionalProperties": false}
}

func aiAgentToolSpecs() []aiAgentToolSpec {
	pathProperty := map[string]any{"path": map[string]any{"type": "string", "description": "Absolute POSIX path on the bound remote host"}}
	return []aiAgentToolSpec{
		{Name: "ssh_exec", Description: "Run one command on the bound remote host", Properties: map[string]any{"command": map[string]any{"type": "string"}}, Required: []string{"command"}},
		{Name: "ssh_list_dir", Description: "List a remote directory", Properties: pathProperty, Required: []string{"path"}},
		{Name: "ssh_stat", Description: "Inspect a remote path", Properties: pathProperty, Required: []string{"path"}},
		{Name: "ssh_read_file", Description: "Read a remote file", Properties: pathProperty, Required: []string{"path"}},
		{Name: "ssh_write_file", Description: "Atomically replace a remote file after approval", Properties: map[string]any{"path": map[string]any{"type": "string"}, "content": map[string]any{"type": "string"}}, Required: []string{"path", "content"}},
		{Name: "task_finish", Description: "Finish the task with a concise result", Properties: map[string]any{"result": map[string]any{"type": "string"}}, Required: []string{"result"}},
	}
}

func nativeAIAgentToolName(name string) (string, bool) {
	tools := map[string]string{"ssh_exec": "ssh.exec", "ssh_list_dir": "ssh.list_dir", "ssh_stat": "ssh.stat", "ssh_read_file": "ssh.read_file", "ssh_write_file": "ssh.write_file", "task_finish": "task.finish"}
	tool, ok := tools[name]
	return tool, ok
}
