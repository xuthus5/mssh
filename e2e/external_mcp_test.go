//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

type mcpClient struct {
	t     *testing.T
	url   string
	token string
	id    int
}

func (client *mcpClient) call(method string, params any) map[string]any {
	client.t.Helper()
	client.id++
	payload := map[string]any{"jsonrpc": "2.0", "id": client.id, "method": method}
	if params != nil {
		payload["params"] = params
	}
	body, err := json.Marshal(payload)
	require.NoError(client.t, err)
	request, err := http.NewRequest(http.MethodPost, client.url, bytes.NewReader(body))
	require.NoError(client.t, err)
	request.Header.Set("Authorization", "Bearer "+client.token)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	require.NoError(client.t, err)
	defer func() { _ = response.Body.Close() }()
	require.Equal(client.t, http.StatusOK, response.StatusCode)
	var decoded map[string]any
	require.NoError(client.t, json.NewDecoder(response.Body).Decode(&decoded))
	return decoded
}

func (client *mcpClient) tool(name string, arguments map[string]any) map[string]any {
	client.t.Helper()
	return client.call("tools/call", map[string]any{"name": name, "arguments": arguments})
}

func TestExternalMCPEndpointOperatesRemoteSession(t *testing.T) {
	fixture := startSSHD(t)
	appInstance, session := newFixtureSession(t, fixture)

	status, err := appInstance.AI.StartAgentMCPServer(model.AIMCPServerInput{SessionID: session.ID})
	require.NoError(t, err)
	require.True(t, status.Running)
	require.NotEmpty(t, status.URL)
	require.NotEmpty(t, status.Token)
	t.Cleanup(func() { require.NoError(t, appInstance.AI.StopAgentMCPServer()) })

	client := &mcpClient{t: t, url: status.URL, token: status.Token}
	assert.Contains(t, fmt.Sprint(client.call("initialize", nil)), "mssh-agent")
	assert.Contains(t, fmt.Sprint(client.call("tools/list", nil)), "ssh.exec")

	exec := client.tool("ssh.exec", map[string]any{"command": "printf __MCP_E2E_OK__"})
	assert.Contains(t, fmt.Sprint(exec), "__MCP_E2E_OK__")
	assert.Contains(t, fmt.Sprint(client.tool("ssh.read_file", map[string]any{"path": "/etc/hostname"})), "content")

	finish := client.tool("task.finish", map[string]any{"result": "e2e done"})
	assert.Contains(t, fmt.Sprint(finish), "e2e done")

	require.Eventually(t, func() bool {
		tasks, listErr := appInstance.AI.ListAgentTasks(session.ID, 10)
		if listErr != nil {
			return false
		}
		for _, task := range tasks {
			if task.Engine == model.AIAgentEngineExternal && task.Status == model.AIAgentTaskCompleted {
				return true
			}
		}
		return false
	}, 5*time.Second, 50*time.Millisecond)
}
