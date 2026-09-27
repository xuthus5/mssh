package service

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func newAIAgentMCPServer(service *AIService, sessionID int64, port int, token string, security model.AISecuritySettings) (*aiAgentMCPServer, error) {
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return nil, fmt.Errorf("listen for external MCP server: %w", err)
	}
	server := &aiAgentMCPServer{
		service: service, sessionID: sessionID, token: token, security: security,
		listener: listener, gate: make(chan struct{}, 1),
	}
	server.gate <- struct{}{}
	server.ctx, server.cancel = context.WithCancel(context.Background())
	server.http = &http.Server{Handler: http.HandlerFunc(serveAIAgentMCPWith(server)), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if serveErr := server.http.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			service.logger.Error("external MCP server stopped unexpectedly", "error", serveErr)
		}
	}()
	return server, nil
}

func serveAIAgentMCPWith(server *aiAgentMCPServer) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		serveAIAgentMCP(server, writer, request)
	}
}

func (server *aiAgentMCPServer) url() string {
	if server.listener == nil {
		return ""
	}
	return "http://" + server.listener.Addr().String() + "/mcp"
}

func (server *aiAgentMCPServer) port() int {
	if server.listener == nil {
		return 0
	}
	if address, ok := server.listener.Addr().(*net.TCPAddr); ok {
		return address.Port
	}
	return 0
}

func (server *aiAgentMCPServer) authorized(request *http.Request) bool {
	return subtle.ConstantTimeCompare([]byte(request.Header.Get("Authorization")), []byte("Bearer "+server.token)) == 1
}

func (server *aiAgentMCPServer) mcpMaxBytes() int {
	if server.security.MaxOutputBytes <= 0 {
		return 64 * 1024
	}
	return server.security.MaxOutputBytes
}

func (server *aiAgentMCPServer) mcpServerInfo() map[string]string {
	return map[string]string{"name": aiAgentMCPServerName, "version": "1"}
}

func (server *aiAgentMCPServer) mcpHandleToolCall(ctx context.Context, writer http.ResponseWriter, message aiAgentMCPRequest) {
	if !server.acquire(ctx) {
		server.mcpWriteError(writer, message.ID, -32003, "MCP server queue is full")
		return
	}
	defer server.release()
	bridge, err := server.currentBridge(ctx)
	if err != nil {
		server.mcpWriteError(writer, message.ID, -32004, err.Error())
		return
	}
	bridge.handleMCPToolCall(ctx, writer, message)
	if bridge.finished {
		server.completeCurrentTask()
	}
}

func (server *aiAgentMCPServer) mcpWriteResult(writer http.ResponseWriter, id json.RawMessage, result any) {
	if err := json.NewEncoder(writer).Encode(aiAgentMCPResponse{JSONRPC: "2.0", ID: id, Result: result}); err != nil {
		server.service.logger.Warn("write external MCP response failed", "error", err)
	}
}

func (server *aiAgentMCPServer) mcpWriteError(writer http.ResponseWriter, id json.RawMessage, code int, message string) {
	if err := json.NewEncoder(writer).Encode(aiAgentMCPResponse{JSONRPC: "2.0", ID: id, Error: &aiAgentMCPError{Code: code, Message: message}}); err != nil {
		server.service.logger.Warn("write external MCP error failed", "error", err)
	}
}

// acquire takes the global FIFO gate, bounding the number of queued callers.
func (server *aiAgentMCPServer) acquire(ctx context.Context) bool {
	if server.pending.Add(1) > aiAgentMCPQueueLimit {
		server.pending.Add(-1)
		return false
	}
	select {
	case <-server.gate:
		return true
	case <-ctx.Done():
		server.pending.Add(-1)
		return false
	case <-server.ctx.Done():
		server.pending.Add(-1)
		return false
	}
}

func (server *aiAgentMCPServer) release() {
	server.gate <- struct{}{}
	server.pending.Add(-1)
}

func (server *aiAgentMCPServer) currentBridge(ctx context.Context) (*aiAgentMCPBridge, error) {
	server.mu.Lock()
	defer server.mu.Unlock()
	if server.bridge != nil && !server.bridge.finished {
		if _, err := server.refreshConnectionLocked(ctx); err != nil {
			return nil, err
		}
		return server.bridge, nil
	}
	if server.bridge != nil {
		server.retireLocked()
	}
	connection, err := server.refreshConnectionLocked(ctx)
	if err != nil {
		return nil, err
	}
	settings, err := store.LoadAISettings(server.service.db, defaultAISettings())
	if err != nil {
		return nil, err
	}
	task, taskCtx, execution, err := server.createExternalTaskLocked()
	if err != nil {
		return nil, err
	}
	bridge := &aiAgentMCPBridge{
		service: server.service, taskCtx: taskCtx, task: *task, execution: execution,
		connection: connection, security: settings.Security, token: server.token,
		callGate: make(chan struct{}, 1),
	}
	bridge.callGate <- struct{}{}
	server.bridge = bridge
	return bridge, nil
}

// refreshConnectionLocked reconnects automatically when the bound SSH transport
// has ended, preserving the current task so step history continues.
func (server *aiAgentMCPServer) refreshConnectionLocked(ctx context.Context) (*aiAgentSSH, error) {
	if server.connection != nil && server.connection.alive() {
		return server.connection, nil
	}
	if server.connection != nil {
		if err := server.connection.Close(); err != nil {
			server.service.logger.Warn("close stale external MCP SSH connection failed", "error", err)
		}
		server.connection = nil
	}
	connection, err := server.service.openAIAgentSSH(ctx, server.sessionID)
	if err != nil {
		return nil, fmt.Errorf("open external MCP SSH connection: %w", err)
	}
	server.connection = connection
	if server.bridge != nil {
		server.bridge.connection = connection
	}
	return connection, nil
}

func (server *aiAgentMCPServer) createExternalTaskLocked() (*model.AIAgentTask, context.Context, *aiAgentExecution, error) {
	task, err := store.CreateAIAgentTask(server.service.db, model.AIAgentTaskInput{SessionID: server.sessionID, Prompt: aiAgentMCPTaskPrompt}, model.AIAgentEngineExternal, "")
	if err != nil {
		return nil, nil, nil, normalizeAIAgentTaskCreateError(err)
	}
	if err := store.UpdateAIAgentTaskStatus(server.service.db, task.ID, model.AIAgentTaskRunning, "", ""); err != nil {
		return nil, nil, nil, err
	}
	taskCtx, cancel := context.WithCancel(server.ctx)
	execution := &aiAgentExecution{cancel: cancel, done: taskCtx.Done(), approvals: make(map[int64]chan bool)}
	server.service.agent.mu.Lock()
	if server.service.agent.tasks == nil {
		server.service.agent.tasks = make(map[int64]*aiAgentExecution)
	}
	server.service.agent.tasks[task.ID] = execution
	server.service.agent.mu.Unlock()
	server.taskCancel = cancel
	server.service.emitAIAgentTask(task.ID)
	return task, taskCtx, execution, nil
}

func (server *aiAgentMCPServer) retireLocked() {
	bridge := server.bridge
	server.bridge = nil
	if bridge != nil {
		_ = store.UpdateAIAgentTaskStatus(server.service.db, bridge.task.ID, model.AIAgentTaskInterrupted, "", "")
		server.service.removeAIAgentExecution(bridge.task.ID)
		server.service.emitAIAgentTask(bridge.task.ID)
	}
	if server.taskCancel != nil {
		server.taskCancel()
		server.taskCancel = nil
	}
}

func (server *aiAgentMCPServer) completeCurrentTask() {
	server.mu.Lock()
	bridge := server.bridge
	server.bridge = nil
	server.mu.Unlock()
	if bridge == nil {
		return
	}
	_ = store.UpdateAIAgentTaskStatus(server.service.db, bridge.task.ID, model.AIAgentTaskCompleted, bridge.result, "")
	server.service.removeAIAgentExecution(bridge.task.ID)
	server.service.emitAIAgentTask(bridge.task.ID)
}

func (server *aiAgentMCPServer) stop() error {
	server.cancel()
	var errs []error
	if server.http != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := server.http.Shutdown(shutdownCtx); err != nil {
			errs = append(errs, fmt.Errorf("stop external MCP HTTP server: %w", err))
		}
	}
	if server.listener != nil {
		if err := server.listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			errs = append(errs, err)
		}
	}
	server.mu.Lock()
	bridge, connection := server.bridge, server.connection
	taskCancel := server.taskCancel
	server.bridge, server.connection, server.taskCancel = nil, nil, nil
	server.mu.Unlock()
	if taskCancel != nil {
		taskCancel()
	}
	if bridge != nil {
		_ = store.UpdateAIAgentTaskStatus(server.service.db, bridge.task.ID, model.AIAgentTaskInterrupted, "", "")
		server.service.removeAIAgentExecution(bridge.task.ID)
		server.service.emitAIAgentTask(bridge.task.ID)
	}
	if connection != nil {
		if err := connection.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// alive reports whether the underlying SSH transport is still usable.
func (connection *aiAgentSSH) alive() bool {
	if connection == nil || connection.client == nil {
		return false
	}
	done := connection.client.Done()
	if done == nil {
		return true
	}
	select {
	case <-done:
		return false
	default:
		return true
	}
}
