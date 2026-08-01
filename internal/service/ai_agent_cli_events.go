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

func validateCodexAIAgentEvent(line []byte) error {
	var event map[string]any
	if err := json.Unmarshal(line, &event); err != nil {
		return fmt.Errorf("decode Codex event: %w", err)
	}
	if len(event) == 0 {
		return fmt.Errorf("codex emitted an empty event")
	}
	eventType, ok := event["type"].(string)
	if !ok {
		return fmt.Errorf("codex event has no type")
	}
	if strings.Contains(strings.ToLower(eventType), "approval") {
		return fmt.Errorf("codex requested approval for a local action")
	}
	if item, ok := event["item"].(map[string]any); ok {
		if err := validateCodexAIAgentItem(item); err != nil {
			return err
		}
	} else {
		if tool := findUnscopedAIAgentTool(event); tool != "" {
			return fmt.Errorf("codex attempted unavailable local tool %q", tool)
		}
	}
	return nil
}

func validateCodexAIAgentItem(item map[string]any) error {
	itemType, _ := item["type"].(string)
	if itemType == "" {
		itemType, _ = item["item_type"].(string)
	}
	switch itemType {
	case "command_execution", "file_change", "web_search", "image_view", "browser":
		return fmt.Errorf("codex attempted unavailable local tool %q", itemType)
	case "mcp_tool_call":
		server, _ := item["server"].(string)
		tool, _ := item["tool"].(string)
		if tool == "" {
			tool, _ = item["tool_name"].(string)
		}
		if server == "codex" && isCodexAIAgentManagementTool(tool) {
			// Codex's own MCP server exposes read-only resource discovery and
			// read tools (list_mcp_resources, list_mcp_resource_templates,
			// read_mcp_resource). They never run local commands or write files,
			// so they are allowed; every other tool on that server fails closed.
			return nil
		}
		if server != "mssh" || !isMSSHAIAgentTool(tool) {
			return fmt.Errorf("codex attempted unavailable tool %q on server %q", tool, server)
		}
	case "approval", "command_approval", "file_change_approval":
		return fmt.Errorf("codex requested approval for a local action")
	}
	return nil
}

func isCodexAIAgentManagementTool(tool string) bool {
	switch tool {
	case "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource":
		return true
	default:
		return false
	}
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
