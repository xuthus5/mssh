package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func newMCPServerTestService(t *testing.T) (*AIService, *model.Session) {
	t.Helper()
	db := testutil.NewTestDB(t)
	session, err := store.CreateSession(db, model.Session{
		Name: "mcp", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30,
	})
	require.NoError(t, err)
	return NewAIService(db, nil, nil, testutil.NewTestLogger()), session
}

func (s *AIService) runningMCPServerForTest() *aiAgentMCPServer {
	s.mcp.mu.Lock()
	defer s.mcp.mu.Unlock()
	return s.mcp.server
}

func TestValidateAIMCPServerSettings(t *testing.T) {
	assert.NoError(t, validateAIMCPServerSettings(model.AIMCPServerSettings{}))
	assert.ErrorContains(t, validateAIMCPServerSettings(model.AIMCPServerSettings{SessionID: -1}), "session id")
	assert.ErrorContains(t, validateAIMCPServerSettings(model.AIMCPServerSettings{Port: 70000}), "port")
}

func TestAgentMCPServerStatusAndLifecycle(t *testing.T) {
	service, session := newMCPServerTestService(t)
	status, err := service.GetAgentMCPServerStatus()
	require.NoError(t, err)
	assert.False(t, status.Running)
	assert.Empty(t, status.Token)

	_, err = service.StartAgentMCPServer(model.AIMCPServerInput{})
	assert.ErrorContains(t, err, "session is required")
	_, err = service.StartAgentMCPServer(model.AIMCPServerInput{SessionID: session.ID + 999})
	assert.Error(t, err)

	status, err = service.StartAgentMCPServer(model.AIMCPServerInput{SessionID: session.ID})
	require.NoError(t, err)
	assert.True(t, status.Running)
	assert.NotEmpty(t, status.Token)
	assert.True(t, strings.HasPrefix(status.URL, "http://127.0.0.1:"))
	assert.Equal(t, session.Name, status.SessionName)
	assert.NotZero(t, status.Port)

	require.NoError(t, service.StopAgentMCPServer())
	stopped, err := service.GetAgentMCPServerStatus()
	require.NoError(t, err)
	assert.False(t, stopped.Running)
	assert.Equal(t, status.Token, stopped.Token)
}

func TestAgentMCPServerTokenRotation(t *testing.T) {
	service, session := newMCPServerTestService(t)
	rotated, err := service.RegenerateAgentMCPToken()
	require.NoError(t, err)
	require.NotEmpty(t, rotated.Token)

	_, err = service.StartAgentMCPServer(model.AIMCPServerInput{SessionID: session.ID})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, service.StopAgentMCPServer()) })
	next, err := service.RegenerateAgentMCPToken()
	require.NoError(t, err)
	assert.NotEqual(t, rotated.Token, next.Token)
	assert.True(t, next.Running)
}

func TestAgentMCPServerHTTPHandshake(t *testing.T) {
	service, session := newMCPServerTestService(t)
	status, err := service.StartAgentMCPServer(model.AIMCPServerInput{SessionID: session.ID})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, service.StopAgentMCPServer()) })
	server := service.runningMCPServerForTest()
	require.NotNil(t, server)

	call := func(method string, body string, token string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, "/mcp", strings.NewReader(body))
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		recorder := httptest.NewRecorder()
		serveAIAgentMCP(server, recorder, request)
		return recorder
	}

	assert.Equal(t, http.StatusMethodNotAllowed, call(http.MethodGet, "", status.Token).Code)
	assert.Equal(t, http.StatusUnauthorized, call(http.MethodPost, "{}", "").Code)
	assert.Equal(t, http.StatusUnauthorized, call(http.MethodPost, "{}", "wrong-token").Code)

	initialize := call(http.MethodPost, `{"jsonrpc":"2.0","id":1,"method":"initialize"}`, status.Token)
	assert.Equal(t, http.StatusOK, initialize.Code)
	assert.Contains(t, initialize.Body.String(), aiAgentMCPServerName)

	assert.Equal(t, http.StatusAccepted, call(http.MethodPost, `{"jsonrpc":"2.0","method":"notifications/initialized"}`, status.Token).Code)
	assert.Contains(t, call(http.MethodPost, `{"jsonrpc":"2.0","id":2,"method":"ping"}`, status.Token).Body.String(), "result")
	assert.Contains(t, call(http.MethodPost, `{"jsonrpc":"2.0","id":3,"method":"tools/list"}`, status.Token).Body.String(), "ssh.exec")
	assert.Contains(t, call(http.MethodPost, `{"jsonrpc":"2.0","id":4,"method":"unknown"}`, status.Token).Body.String(), "method not found")
	assert.Contains(t, call(http.MethodPost, "not-json", status.Token).Body.String(), "invalid JSON-RPC request")
}

func TestAgentMCPServerQueueGate(t *testing.T) {
	server := &aiAgentMCPServer{gate: make(chan struct{}, 1)}
	server.gate <- struct{}{}
	server.ctx, server.cancel = context.WithCancel(context.Background())
	defer server.cancel()

	require.True(t, server.acquire(context.Background()))
	assert.Equal(t, int64(1), server.pending.Load())
	server.release()
	assert.Equal(t, int64(0), server.pending.Load())

	<-server.gate // occupy the gate so the next acquire must observe cancellation
	cancelled, cancelRequest := context.WithCancel(context.Background())
	cancelRequest()
	assert.False(t, server.acquire(cancelled))
	assert.Equal(t, int64(0), server.pending.Load())
	server.gate <- struct{}{}
}

func TestAgentMCPServerHelpersWithoutListener(t *testing.T) {
	server := &aiAgentMCPServer{}
	assert.Empty(t, server.url())
	assert.Equal(t, 0, server.port())
	assert.Equal(t, 64*1024, server.mcpMaxBytes())
	server.security = model.AISecuritySettings{MaxOutputBytes: 2048}
	assert.Equal(t, 2048, server.mcpMaxBytes())
	assert.Equal(t, aiAgentMCPServerName, server.mcpServerInfo()["name"])

	request := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	assert.False(t, server.authorized(request))

	recorder := httptest.NewRecorder()
	server.mcpWriteResult(recorder, json.RawMessage("1"), map[string]any{"ok": true})
	assert.Contains(t, recorder.Body.String(), "result")
	recorder = httptest.NewRecorder()
	server.mcpWriteError(recorder, json.RawMessage("1"), -32000, "boom")
	assert.Contains(t, recorder.Body.String(), "boom")
}

func TestAgentMCPServerTaskLifecycleHelpers(t *testing.T) {
	service, session := newMCPServerTestService(t)
	server := &aiAgentMCPServer{service: service, sessionID: session.ID, token: "token", gate: make(chan struct{}, 1)}
	server.gate <- struct{}{}
	server.ctx, server.cancel = context.WithCancel(context.Background())

	task, taskCtx, execution, err := server.createExternalTaskLocked()
	require.NoError(t, err)
	require.NotNil(t, execution)
	require.NoError(t, taskCtx.Err())

	bridge := &aiAgentMCPBridge{service: service, task: *task, execution: execution, token: "token", callGate: make(chan struct{}, 1)}
	bridge.callGate <- struct{}{}
	server.bridge = bridge
	server.completeCurrentTask()
	completed, err := service.GetAgentTask(task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AIAgentTaskCompleted, completed.Status)
	assert.Nil(t, server.bridge)

	retired, _, retiredExecution, err := server.createExternalTaskLocked()
	require.NoError(t, err)
	server.bridge = &aiAgentMCPBridge{service: service, task: *retired, execution: retiredExecution}
	server.retireLocked()
	interrupted, err := service.GetAgentTask(retired.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AIAgentTaskInterrupted, interrupted.Status)

	require.NoError(t, server.stop())
	assert.ErrorIs(t, server.ctx.Err(), context.Canceled)
}

func TestAIAgentSSHAlive(t *testing.T) {
	assert.False(t, (*aiAgentSSH)(nil).alive())
	assert.False(t, (&aiAgentSSH{}).alive())
}
