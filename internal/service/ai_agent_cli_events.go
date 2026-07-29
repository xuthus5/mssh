package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

func validateAIAgentCLIEvent(line []byte, cliName string) error {
	var event map[string]any
	if err := json.Unmarshal(line, &event); err != nil {
		return fmt.Errorf("decode %s event: %w", cliName, err)
	}
	if len(event) == 0 {
		return fmt.Errorf("%s emitted an empty event", cliName)
	}
	if _, ok := event["type"].(string); !ok {
		return fmt.Errorf("%s event has no type", cliName)
	}
	if tool := findUnscopedAIAgentTool(event); tool != "" {
		return fmt.Errorf("%s attempted unavailable local tool %q", cliName, tool)
	}
	return nil
}

func findUnscopedAIAgentTool(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		if tool := unscopedAIAgentToolName(typed); tool != "" {
			return tool
		}
		for _, child := range typed {
			if tool := findUnscopedAIAgentTool(child); tool != "" {
				return tool
			}
		}
	case []any:
		for _, child := range typed {
			if tool := findUnscopedAIAgentTool(child); tool != "" {
				return tool
			}
		}
	}
	return ""
}

func unscopedAIAgentToolName(event map[string]any) string {
	eventType, _ := event["type"].(string)
	if !strings.Contains(strings.ToLower(eventType), "tool") {
		return localAIAgentToolField(event)
	}
	for _, key := range []string{"name", "tool", "tool_name", "toolName"} {
		if name, ok := event[key].(string); ok && name != "" && !isMSSHAIAgentTool(name) {
			return name
		}
	}
	return ""
}

func localAIAgentToolField(event map[string]any) string {
	for _, key := range []string{"tool", "tool_name", "toolName"} {
		if name, ok := event[key].(string); ok && isKnownLocalAIAgentTool(name) {
			return name
		}
	}
	return ""
}

func isMSSHAIAgentTool(name string) bool {
	normalized := strings.ToLower(name)
	return strings.Contains(normalized, "mssh") || strings.HasPrefix(normalized, "ssh.") || normalized == "task.finish"
}

func isKnownLocalAIAgentTool(name string) bool {
	switch strings.ToLower(name) {
	case "bash", "shell", "read", "write", "edit", "glob", "grep", "webfetch", "websearch", "browser", "task", "notebookedit":
		return true
	default:
		return false
	}
}
