package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

// 覆盖 expirePendingOutputIfCurrent 在“有缓存输出、无活动 PTY、未挂载”时的清理分支。
func TestExpirePendingOutputIfCurrentClearsDetachedBuffer(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 32, testutil.NewTestLogger())
	service.pendingOutput["detached-pane"] = []byte("final output")
	service.pendingSessionIDs["detached-pane"] = 42
	service.outputSequences["detached-pane"] = 9

	service.expirePendingOutputIfCurrent("detached-pane", nil)

	assert.NotContains(t, service.pendingOutput, "detached-pane")
	assert.NotContains(t, service.pendingSessionIDs, "detached-pane")
	assert.NotContains(t, service.outputSequences, "detached-pane")
	assert.NotContains(t, service.outputDispatchers, "detached-pane")
}

// 覆盖 launchAIAgentTask 在 agent 运行已停止时的拒绝分支。
func TestLaunchAIAgentTaskRejectsStoppingRuntime(t *testing.T) {
	service := NewAIService(testutil.NewTestDB(t), nil, nil, testutil.NewTestLogger())
	service.agent.stopping = true

	require.ErrorIs(t, service.launchAIAgentTask(1), errAIServiceStopped)
}
