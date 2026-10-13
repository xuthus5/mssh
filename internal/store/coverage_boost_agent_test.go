package store

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func closedAgentDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, InitializeSchema(db))
	require.NoError(t, db.Close())
	return db
}

// 覆盖 AI agent 存储层在数据库不可用时的错误分支。
func TestAIAgentStoreRejectsUnavailableDatabase(t *testing.T) {
	db := closedAgentDB(t)

	_, err := CreateAIAgentTask(db, model.AIAgentTaskInput{Prompt: "x"}, model.AIAgentEngineNative, "")
	require.ErrorContains(t, err, "create AI agent task")

	_, err = ListAIAgentTasks(db, 0, 10)
	require.ErrorContains(t, err, "list AI agent tasks")

	_, err = GetAIAgentTask(db, 1)
	require.Error(t, err)

	require.ErrorContains(t, UpdateAIAgentTaskStatus(db, 1, model.AIAgentTaskRunning, "", ""), "update AI agent task")
	require.ErrorContains(t, DeleteAIAgentTask(db, 1), "begin AI agent task delete")
	require.ErrorContains(t, ResumeAIAgentTask(db, 1), "begin AI agent task resume")
	require.ErrorContains(t, MarkAIAgentTasksInterrupted(db), "interrupt AI agent tasks")
	_, err = CreateAIAgentStep(db, model.AIAgentStep{TaskID: 1})
	require.ErrorContains(t, err, "begin AI agent step")
	_, err = GetAIAgentStep(db, 1)
	require.Error(t, err)
	_, err = ListAIAgentSteps(db, 1)
	require.ErrorContains(t, err, "list AI agent steps")
	require.ErrorContains(t, ResolveAIAgentStepApproval(db, 1, 1, true), "resolve AI agent approval")
	require.ErrorContains(t, UpdateAIAgentStepResult(db, 1, "", ""), "update AI agent step result")
}

type orderedSettingScanner struct {
	texts []string
	nulls []sql.NullString
}

func (s orderedSettingScanner) Scan(dest ...any) error {
	textIndex, nullIndex := 0, 0
	for _, target := range dest {
		switch value := target.(type) {
		case *string:
			if textIndex < len(s.texts) {
				*value = s.texts[textIndex]
				textIndex++
			}
		case *sql.NullString:
			if nullIndex < len(s.nulls) {
				*value = s.nulls[nullIndex]
				nullIndex++
			}
		}
	}
	return nil
}

const agentTimestamp = "2026-01-02 03:04:05"

// taskScanner 按列顺序填充：SessionName/Prompt/Result/Error 为空串，created/updated 由入参决定。
func taskScanner(created, updated string, nulls []sql.NullString) orderedSettingScanner {
	return orderedSettingScanner{texts: []string{"", "", "", "", created, updated}, nulls: nulls}
}

// stepScanner 按列顺序填充：Kind/ModelOutput/ToolName/ToolInput/ToolOutput/Error 为空串，created/updated 由入参决定。
func stepScanner(created, updated string) orderedSettingScanner {
	return orderedSettingScanner{texts: []string{"", "", "", "", "", "", created, updated}}
}

// 覆盖 AI agent 行扫描在时间戳非法时的解析错误分支。
func TestAIAgentScannersRejectInvalidTimestamps(t *testing.T) {
	invalid := sql.NullString{String: "not-a-time", Valid: true}

	_, err := scanAIAgentTask(taskScanner("bad", agentTimestamp, nil))
	require.ErrorContains(t, err, "parse AI agent task created_at")

	_, err = scanAIAgentTask(taskScanner(agentTimestamp, "bad", nil))
	require.ErrorContains(t, err, "parse AI agent task updated_at")

	_, err = scanAIAgentTask(taskScanner(agentTimestamp, agentTimestamp, []sql.NullString{invalid}))
	require.ErrorContains(t, err, "parse AI agent task time")

	_, err = scanAIAgentTask(taskScanner(agentTimestamp, agentTimestamp, []sql.NullString{{String: agentTimestamp, Valid: true}, invalid}))
	require.ErrorContains(t, err, "parse AI agent task time")

	_, err = scanAIAgentStep(stepScanner("bad", agentTimestamp))
	require.ErrorContains(t, err, "parse AI agent step created_at")

	_, err = scanAIAgentStep(stepScanner(agentTimestamp, "bad"))
	require.ErrorContains(t, err, "parse AI agent step updated_at")

	_, err = parseOptionalAIAgentTime(invalid)
	require.ErrorContains(t, err, "parse AI agent task time")

	parsed, err := parseOptionalAIAgentTime(sql.NullString{})
	require.NoError(t, err)
	assert.Nil(t, parsed)
}
