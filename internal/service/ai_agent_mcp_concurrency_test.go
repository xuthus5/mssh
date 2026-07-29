package service

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAIAgentMCPSerializesToolCallsAcrossApproval(t *testing.T) {
	service, bridge, execution, server := newAIAgentMCPConcurrencyFixture(t)
	first := make(chan error, 1)
	go func() {
		first <- postAIAgentMCPRequest(server.URL, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ssh.write_file","arguments":{"path":"/tmp/a","content":"x"}}}`)
	}()
	require.Eventually(t, func() bool { return pendingAIAgentApproval(service, bridge.task.ID) }, time.Second, 10*time.Millisecond)
	second := make(chan error, 1)
	go func() {
		second <- postAIAgentMCPRequest(server.URL, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"task.finish","arguments":{"result":"done"}}}`)
	}()
	select {
	case err := <-second:
		t.Fatalf("second MCP call bypassed pending approval: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	steps, err := store.ListAIAgentSteps(service.db, bridge.task.ID)
	require.NoError(t, err)
	require.NoError(t, service.ApproveAgentStep(bridge.task.ID, steps[0].ID, false))
	require.NoError(t, <-first)
	require.NoError(t, <-second)
	assert.True(t, bridge.finished)
	assert.Empty(t, execution.approvals)
}

func TestAIAgentMCPCancelDropsQueuedToolCall(t *testing.T) {
	service, bridge, execution, server := newAIAgentMCPConcurrencyFixture(t)
	first := make(chan error, 1)
	go func() {
		first <- postAIAgentMCPRequest(server.URL, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ssh.write_file","arguments":{"path":"/tmp/a","content":"x"}}}`)
	}()
	require.Eventually(t, func() bool { return pendingAIAgentApproval(service, bridge.task.ID) }, time.Second, 10*time.Millisecond)
	second := make(chan error, 1)
	go func() {
		second <- postAIAgentMCPRequest(server.URL, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"task.finish","arguments":{"result":"late"}}}`)
	}()
	execution.cancel()
	require.NoError(t, <-first)
	require.NoError(t, <-second)
	steps, err := store.ListAIAgentSteps(service.db, bridge.task.ID)
	require.NoError(t, err)
	require.Len(t, steps, 1)
	assert.Equal(t, "ssh.write_file", steps[0].ToolName)
	assert.False(t, bridge.finished)
}

func newAIAgentMCPConcurrencyFixture(t *testing.T) (*AIService, *aiAgentMCPBridge, *aiAgentExecution, *httptest.Server) {
	t.Helper()
	db := testutil.NewTestDB(t)
	session, err := store.CreateSession(db, model.Session{Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30})
	require.NoError(t, err)
	task, err := store.CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: session.ID, Prompt: "change"}, model.AIAgentEngineLocalCLI, model.AIAgentCLIClaude)
	require.NoError(t, err)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	taskCtx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	execution := &aiAgentExecution{cancel: cancel, done: taskCtx.Done(), approvals: make(map[int64]chan bool)}
	service.agent.tasks = map[int64]*aiAgentExecution{task.ID: execution}
	bridge := &aiAgentMCPBridge{service: service, taskCtx: taskCtx, task: *task, execution: execution, security: defaultAISettings().Security, token: "secret"}
	server := httptest.NewServer(http.HandlerFunc(bridge.serveHTTP))
	t.Cleanup(server.Close)
	return service, bridge, execution, server
}

func pendingAIAgentApproval(service *AIService, taskID int64) bool {
	steps, err := store.ListAIAgentSteps(service.db, taskID)
	return err == nil && len(steps) == 1 && steps[0].ApprovalStatus == model.AIAgentApprovalPending
}

func postAIAgentMCPRequest(endpoint, body string) error {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, endpoint, bytes.NewBufferString(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer secret")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	_, err = io.Copy(io.Discard, response.Body)
	return err
}
