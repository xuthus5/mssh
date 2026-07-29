package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

const aiAgentTimeLayout = "2006-01-02 15:04:05"

func CreateAIAgentTask(db *sql.DB, input model.AIAgentTaskInput, engine model.AIAgentEngine, cli model.AIAgentCLI) (*model.AIAgentTask, error) {
	result, err := db.Exec(`INSERT INTO ai_agent_tasks (session_id, engine, cli, prompt, status) VALUES (?, ?, ?, ?, ?)`,
		input.SessionID, engine, cli, input.Prompt, model.AIAgentTaskPending)
	if err != nil {
		return nil, fmt.Errorf("create AI agent task: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("read AI agent task id: %w", err)
	}
	return GetAIAgentTask(db, id)
}

func ListAIAgentTasks(db *sql.DB, sessionID int64, limit int) ([]model.AIAgentTask, error) {
	query := aiAgentTaskSelect + " ORDER BY t.id DESC LIMIT ?"
	args := []any{limit}
	if sessionID > 0 {
		query = aiAgentTaskSelect + " WHERE t.session_id = ? ORDER BY t.id DESC LIMIT ?"
		args = []any{sessionID, limit}
	}
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list AI agent tasks: %w", err)
	}
	defer func() { _ = rows.Close() }()
	tasks := make([]model.AIAgentTask, 0)
	for rows.Next() {
		task, scanErr := scanAIAgentTask(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func GetAIAgentTask(db *sql.DB, id int64) (*model.AIAgentTask, error) {
	task, err := scanAIAgentTask(db.QueryRow(aiAgentTaskSelect+" WHERE t.id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	steps, err := ListAIAgentSteps(db, id)
	if err != nil {
		return nil, err
	}
	task.Steps = steps
	return &task, nil
}

func UpdateAIAgentTaskStatus(db *sql.DB, id int64, status model.AIAgentTaskStatus, result, taskError string) error {
	finished := "NULL"
	if isAIAgentTerminalStatus(status) {
		finished = "datetime('now')"
	}
	query := `UPDATE ai_agent_tasks SET status=?, result=?, error=?, updated_at=datetime('now'),
		started_at=CASE WHEN ?='running' AND started_at IS NULL THEN datetime('now') ELSE started_at END,
		finished_at=` + finished + ` WHERE id=?`
	resultValue, err := db.Exec(query, status, result, taskError, status, id)
	if err != nil {
		return fmt.Errorf("update AI agent task: %w", err)
	}
	return requireAffected(resultValue, "AI agent task")
}

func ResumeAIAgentTask(db *sql.DB, id int64) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin AI agent task resume: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`UPDATE ai_agent_tasks SET status='pending', result='', error='', updated_at=datetime('now'), finished_at=NULL WHERE id=? AND status='interrupted'`, id)
	if err != nil {
		return fmt.Errorf("resume AI agent task: %w", err)
	}
	if err = requireAffected(result, "interrupted AI agent task"); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE ai_agent_steps SET approval_status='rejected', tool_output=CASE WHEN tool_output='' THEN '应用中断，工具未执行' ELSE tool_output END, updated_at=datetime('now') WHERE task_id=? AND approval_status='pending'`, id); err != nil {
		return fmt.Errorf("resolve interrupted AI agent approvals: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit AI agent task resume: %w", err)
	}
	return nil
}

func MarkAIAgentTasksInterrupted(db *sql.DB) error {
	_, err := db.Exec(`UPDATE ai_agent_tasks SET status='interrupted', error=CASE WHEN error='' THEN '应用已关闭，任务已中断' ELSE error END, updated_at=datetime('now'), finished_at=datetime('now') WHERE status IN ('pending','running','waiting_approval')`)
	if err != nil {
		return fmt.Errorf("interrupt AI agent tasks: %w", err)
	}
	return nil
}

func CreateAIAgentStep(db *sql.DB, step model.AIAgentStep) (*model.AIAgentStep, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin AI agent step: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`INSERT INTO ai_agent_steps (task_id, sequence, kind, model_output, tool_name, tool_input, tool_output, risk, approval_status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		step.TaskID, step.Sequence, step.Kind, step.ModelOutput, step.ToolName, step.ToolInput, step.ToolOutput, step.Risk, step.ApprovalStatus, step.Error)
	if err != nil {
		return nil, fmt.Errorf("create AI agent step: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("read AI agent step id: %w", err)
	}
	if _, err = tx.Exec(`UPDATE ai_agent_tasks SET step_count=step_count+1, updated_at=datetime('now') WHERE id=?`, step.TaskID); err != nil {
		return nil, fmt.Errorf("increment AI agent step count: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit AI agent step: %w", err)
	}
	return GetAIAgentStep(db, id)
}

func GetAIAgentStep(db *sql.DB, id int64) (*model.AIAgentStep, error) {
	step, err := scanAIAgentStep(db.QueryRow(aiAgentStepSelect+" WHERE id=?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &step, nil
}

func ListAIAgentSteps(db *sql.DB, taskID int64) ([]model.AIAgentStep, error) {
	rows, err := db.Query(aiAgentStepSelect+" WHERE task_id=? ORDER BY sequence", taskID)
	if err != nil {
		return nil, fmt.Errorf("list AI agent steps: %w", err)
	}
	defer func() { _ = rows.Close() }()
	steps := make([]model.AIAgentStep, 0)
	for rows.Next() {
		step, scanErr := scanAIAgentStep(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		steps = append(steps, step)
	}
	return steps, rows.Err()
}

func ResolveAIAgentStepApproval(db *sql.DB, taskID, stepID int64, approved bool) error {
	status := model.AIAgentApprovalRejected
	if approved {
		status = model.AIAgentApprovalApproved
	}
	result, err := db.Exec(`UPDATE ai_agent_steps SET approval_status=?, updated_at=datetime('now') WHERE id=? AND task_id=? AND approval_status='pending'`, status, stepID, taskID)
	if err != nil {
		return fmt.Errorf("resolve AI agent approval: %w", err)
	}
	return requireAffected(result, "pending AI agent step")
}

func UpdateAIAgentStepResult(db *sql.DB, id int64, output, stepError string) error {
	result, err := db.Exec(`UPDATE ai_agent_steps SET tool_output=?, error=?, updated_at=datetime('now') WHERE id=?`, output, stepError, id)
	if err != nil {
		return fmt.Errorf("update AI agent step result: %w", err)
	}
	return requireAffected(result, "AI agent step")
}

const aiAgentTaskSelect = `SELECT t.id, t.session_id, s.name, t.engine, t.cli, t.prompt, t.status, t.step_count, t.result, t.error, t.created_at, t.updated_at, t.started_at, t.finished_at FROM ai_agent_tasks t JOIN sessions s ON s.id=t.session_id`

const aiAgentStepSelect = `SELECT id, task_id, sequence, kind, model_output, tool_name, tool_input, tool_output, risk, approval_status, error, created_at, updated_at FROM ai_agent_steps`

func scanAIAgentTask(scanner settingScanner) (model.AIAgentTask, error) {
	var task model.AIAgentTask
	var created, updated string
	var started, finished sql.NullString
	if err := scanner.Scan(&task.ID, &task.SessionID, &task.SessionName, &task.Engine, &task.CLI, &task.Prompt, &task.Status, &task.StepCount, &task.Result, &task.Error, &created, &updated, &started, &finished); err != nil {
		return task, err
	}
	var err error
	if task.CreatedAt, err = time.Parse(aiAgentTimeLayout, created); err != nil {
		return task, fmt.Errorf("parse AI agent task created_at: %w", err)
	}
	if task.UpdatedAt, err = time.Parse(aiAgentTimeLayout, updated); err != nil {
		return task, fmt.Errorf("parse AI agent task updated_at: %w", err)
	}
	if task.StartedAt, err = parseOptionalAIAgentTime(started); err != nil {
		return task, err
	}
	if task.FinishedAt, err = parseOptionalAIAgentTime(finished); err != nil {
		return task, err
	}
	return task, nil
}

func scanAIAgentStep(scanner settingScanner) (model.AIAgentStep, error) {
	var step model.AIAgentStep
	var created, updated string
	if err := scanner.Scan(&step.ID, &step.TaskID, &step.Sequence, &step.Kind, &step.ModelOutput, &step.ToolName, &step.ToolInput, &step.ToolOutput, &step.Risk, &step.ApprovalStatus, &step.Error, &created, &updated); err != nil {
		return step, err
	}
	var err error
	if step.CreatedAt, err = time.Parse(aiAgentTimeLayout, created); err != nil {
		return step, fmt.Errorf("parse AI agent step created_at: %w", err)
	}
	if step.UpdatedAt, err = time.Parse(aiAgentTimeLayout, updated); err != nil {
		return step, fmt.Errorf("parse AI agent step updated_at: %w", err)
	}
	return step, nil
}

func parseOptionalAIAgentTime(value sql.NullString) (*time.Time, error) {
	if !value.Valid {
		return nil, nil
	}
	parsed, err := time.Parse(aiAgentTimeLayout, value.String)
	if err != nil {
		return nil, fmt.Errorf("parse AI agent task time: %w", err)
	}
	return &parsed, nil
}

func isAIAgentTerminalStatus(status model.AIAgentTaskStatus) bool {
	switch status {
	case model.AIAgentTaskCompleted, model.AIAgentTaskFailed, model.AIAgentTaskCancelled, model.AIAgentTaskInterrupted:
		return true
	default:
		return false
	}
}
