package service

import (
	"context"
	"encoding/json"
	"net/http"
)

type aiAgentMCPRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type aiAgentMCPResponse struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      json.RawMessage  `json:"id,omitempty"`
	Result  any              `json:"result,omitempty"`
	Error   *aiAgentMCPError `json:"error,omitempty"`
}

type aiAgentMCPError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (bridge *aiAgentMCPBridge) serveHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if request.Header.Get("Authorization") != "Bearer "+bridge.token {
		http.Error(writer, "unauthorized", http.StatusUnauthorized)
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, int64(bridge.security.MaxOutputBytes))
	var message aiAgentMCPRequest
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&message); err != nil {
		bridge.writeMCPError(writer, nil, -32700, "invalid JSON-RPC request")
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	switch message.Method {
	case "initialize":
		bridge.writeMCPResult(writer, message.ID, map[string]any{"protocolVersion": aiAgentMCPProtocolVersion, "capabilities": map[string]any{"tools": map[string]any{}}, "serverInfo": map[string]string{"name": "mssh-agent", "version": "1"}})
	case "notifications/initialized":
		writer.WriteHeader(http.StatusAccepted)
	case "ping":
		bridge.writeMCPResult(writer, message.ID, map[string]any{})
	case "tools/list":
		bridge.writeMCPResult(writer, message.ID, map[string]any{"tools": aiAgentMCPTools()})
	case "tools/call":
		bridge.handleMCPToolCall(request.Context(), writer, message)
	default:
		bridge.writeMCPError(writer, message.ID, -32601, "method not found")
	}
}

func (bridge *aiAgentMCPBridge) handleMCPToolCall(ctx context.Context, writer http.ResponseWriter, message aiAgentMCPRequest) {
	if !bridge.beginMCPToolCall(ctx) {
		bridge.writeMCPError(writer, message.ID, -32002, "task was cancelled")
		return
	}
	defer bridge.endMCPToolCall()
	var params struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(message.Params, &params); err != nil {
		bridge.writeMCPError(writer, message.ID, -32602, "invalid tool parameters")
		return
	}
	bridge.mu.Lock()
	if bridge.finished {
		bridge.mu.Unlock()
		bridge.writeMCPError(writer, message.ID, -32000, "task already finished")
		return
	}
	if bridge.sequence >= bridge.security.MaxPlanSteps {
		bridge.mu.Unlock()
		bridge.writeMCPError(writer, message.ID, -32001, "task reached its maximum step count")
		return
	}
	bridge.sequence++
	sequence := bridge.sequence
	bridge.mu.Unlock()
	action := aiAgentAction{Tool: params.Name, Arguments: params.Arguments, Reason: "本机 Agent CLI 工具调用"}
	result, finished, err := bridge.service.performAIAgentAction(bridge.actionContext(), bridge.task.ID, sequence, action, bridge.execution, bridge.connection, bridge.security)
	if err != nil {
		bridge.writeMCPToolResult(writer, message.ID, "error: "+err.Error(), true)
		return
	}
	if finished {
		bridge.mu.Lock()
		bridge.result, bridge.finished = result, true
		bridge.mu.Unlock()
	}
	bridge.writeMCPToolResult(writer, message.ID, result, false)
}

func (bridge *aiAgentMCPBridge) beginMCPToolCall(ctx context.Context) bool {
	bridge.mu.Lock()
	if bridge.callGate == nil {
		bridge.callGate = make(chan struct{}, 1)
		bridge.callGate <- struct{}{}
	}
	gate := bridge.callGate
	done := bridge.execution.done
	bridge.mu.Unlock()
	select {
	case <-ctx.Done():
		return false
	case <-done:
		return false
	case <-gate:
	}
	select {
	case <-done:
		gate <- struct{}{}
		return false
	default:
		return true
	}
}

func (bridge *aiAgentMCPBridge) endMCPToolCall() {
	bridge.callGate <- struct{}{}
}

func (bridge *aiAgentMCPBridge) actionContext() context.Context {
	if bridge.taskCtx != nil {
		return bridge.taskCtx
	}
	return context.Background()
}

func (bridge *aiAgentMCPBridge) writeMCPToolResult(writer http.ResponseWriter, id json.RawMessage, text string, isError bool) {
	bridge.writeMCPResult(writer, id, map[string]any{"content": []map[string]string{{"type": "text", "text": text}}, "isError": isError})
}

func (bridge *aiAgentMCPBridge) writeMCPResult(writer http.ResponseWriter, id json.RawMessage, result any) {
	if err := json.NewEncoder(writer).Encode(aiAgentMCPResponse{JSONRPC: "2.0", ID: id, Result: result}); err != nil {
		bridge.service.logger.Warn("write AI agent MCP response failed", "taskID", bridge.task.ID, "error", err)
	}
}

func (bridge *aiAgentMCPBridge) writeMCPError(writer http.ResponseWriter, id json.RawMessage, code int, message string) {
	if err := json.NewEncoder(writer).Encode(aiAgentMCPResponse{JSONRPC: "2.0", ID: id, Error: &aiAgentMCPError{Code: code, Message: message}}); err != nil {
		bridge.service.logger.Warn("write AI agent MCP error failed", "taskID", bridge.task.ID, "error", err)
	}
}

func aiAgentMCPTools() []map[string]any {
	return []map[string]any{
		mcpTool("ssh.exec", "在任务绑定的远程主机执行非交互 POSIX 命令", map[string]any{"command": map[string]string{"type": "string"}}, []string{"command"}),
		mcpTool("ssh.list_dir", "列出远程目录", pathMCPProperties(), []string{"path"}),
		mcpTool("ssh.stat", "读取远程路径元数据", pathMCPProperties(), []string{"path"}),
		mcpTool("ssh.read_file", "读取远程文件", pathMCPProperties(), []string{"path"}),
		mcpTool("ssh.write_file", "原子写入远程文件，需要用户审批", map[string]any{"path": map[string]string{"type": "string"}, "content": map[string]string{"type": "string"}}, []string{"path", "content"}),
		mcpTool("task.finish", "提交最终任务结果", map[string]any{"result": map[string]string{"type": "string"}}, []string{"result"}),
	}
}

func pathMCPProperties() map[string]any {
	return map[string]any{"path": map[string]string{"type": "string"}}
}

func mcpTool(name, description string, properties map[string]any, required []string) map[string]any {
	return map[string]any{"name": name, "description": description, "inputSchema": map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}}
}
