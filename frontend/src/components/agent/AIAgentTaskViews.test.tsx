import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { AIAgentSessionPanel } from '@/components/agent/AIAgentTaskViews'
import { requestConfirm } from '@/lib/confirmDialog'
import { AIAgentApprovalStatus, AIAgentCLI, AIAgentEngine, AIAgentTask, AIAgentTaskStatus, AICommandRisk } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

vi.mock('@/lib/confirmDialog', () => ({ requestConfirm: vi.fn(async () => true) }))

const listCall = 'github.com/xuthus5/mssh/internal/service.AIService.ListAgentTasks'
const startCall = 'github.com/xuthus5/mssh/internal/service.AIService.StartAgentTask'
const approveCall = 'github.com/xuthus5/mssh/internal/service.AIService.ApproveAgentStep'
const cancelCall = 'github.com/xuthus5/mssh/internal/service.AIService.CancelAgentTask'
const resumeCall = 'github.com/xuthus5/mssh/internal/service.AIService.ResumeAgentTask'
const retryCall = 'github.com/xuthus5/mssh/internal/service.AIService.RetryAgentTask'
const deleteCall = 'github.com/xuthus5/mssh/internal/service.AIService.DeleteAgentTask'

describe('AIAgentSessionPanel', () => {
  beforeEach(() => __clearHandlers())

  it('starts a task with inherited engine defaults', async () => {
    let tasks: AIAgentTask[] = []
    const start = vi.fn(async (input) => {
      const task = createTask({ id: 1, prompt: input.prompt, status: AIAgentTaskStatus.AIAgentTaskRunning })
      tasks = [task]
      return task
    })
    __registerHandler(listCall, async () => tasks)
    __registerHandler(startCall, start)
    render(<AIAgentSessionPanel sessionID={9} sessionName="prod" />)
    await userEvent.type(screen.getByPlaceholderText('描述要在 prod 上完成的任务'), 'inspect disk')
    await userEvent.click(screen.getByRole('button', { name: '运行 Agent' }))
    await waitFor(() => expect(start).toHaveBeenCalledWith({ session_id: 9, prompt: 'inspect disk', engine: null, cli: null }))
    expect((await screen.findAllByText('inspect disk')).length).toBeGreaterThan(0)
  })

  it('starts a task with local CLI overrides', async () => {
    const start = vi.fn(async () => createTask({ engine: AIAgentEngine.AIAgentEngineLocalCLI, cli: AIAgentCLI.AIAgentCLIOpenCode }))
    __registerHandler(listCall, async () => [])
    __registerHandler(startCall, start)
    render(<AIAgentSessionPanel sessionID={9} sessionName="prod" />)
    await userEvent.click(screen.getByRole('combobox', { name: '任务引擎' }))
    await userEvent.click(await screen.findByRole('option', { name: '本机 CLI' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Agent CLI' }))
    await userEvent.click(await screen.findByRole('option', { name: 'OpenCode' }))
    await userEvent.type(screen.getByPlaceholderText('描述要在 prod 上完成的任务'), 'inspect disk')
    await userEvent.click(screen.getByRole('button', { name: '运行 Agent' }))
    await waitFor(() => expect(start).toHaveBeenCalledWith({ session_id: 9, prompt: 'inspect disk', engine: 'local_cli', cli: 'opencode' }))
  })

  it('ignores stale task list responses after an event reload', async () => {
    const first = deferred<AIAgentTask[]>()
    let calls = 0
    __registerHandler(listCall, async () => calls++ === 0 ? first.promise : [createTask({ id: 2, prompt: 'new task' })])
    render(<AIAgentSessionPanel sessionID={9} sessionName="prod" />)
    await waitFor(() => expect(calls).toBe(1))
    __emitEvent('ai:agent-task-changed', { data: createTask({ id: 2 }) })
    expect((await screen.findAllByText('new task')).length).toBeGreaterThan(0)
    await act(async () => { first.resolve([createTask({ id: 1, prompt: 'stale task' })]); await first.promise })
    expect(screen.queryByText('stale task')).not.toBeInTheDocument()
  })

  it('approves, rejects, cancels and resumes tasks', async () => {
    const approve = vi.fn(async () => undefined)
    const cancel = vi.fn(async () => undefined)
    const resume = vi.fn(async () => createTask({ status: AIAgentTaskStatus.AIAgentTaskPending }))
    let tasks = [createTask({ status: AIAgentTaskStatus.AIAgentTaskWaitingApproval, steps: [{ id: 4, task_id: 1, sequence: 1, kind: 'tool', model_output: 'write config', tool_name: 'ssh.write_file', tool_input: '{"path":"/tmp/a"}', tool_output: '', risk: AICommandRisk.AICommandRiskModify, approval_status: AIAgentApprovalStatus.AIAgentApprovalPending, error: '', created_at: '', updated_at: '' }] })]
    __registerHandler(listCall, async () => tasks)
    __registerHandler(approveCall, approve)
    __registerHandler(cancelCall, cancel)
    __registerHandler(resumeCall, resume)
    render(<AIAgentSessionPanel sessionID={9} sessionName="prod" />)
    await userEvent.click(await screen.findByRole('button', { name: '批准' }))
    expect(approve).toHaveBeenCalledWith(1, 4, true)
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(cancel).toHaveBeenCalledWith(1)

    tasks = [createTask({ status: AIAgentTaskStatus.AIAgentTaskInterrupted, steps: [] })]
    __emitEvent('ai:agent-task-changed', { data: tasks[0] })
    await waitFor(() => expect(screen.getByRole('button', { name: '恢复' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '恢复' }))
    expect(resume).toHaveBeenCalledWith(1)
  })

  it('shows prominent approve and reject actions for a task awaiting approval', async () => {
    const approve = vi.fn(async () => undefined)
    const tasks = [createTask({ status: AIAgentTaskStatus.AIAgentTaskWaitingApproval, steps: [{ id: 4, task_id: 1, sequence: 1, kind: 'tool', model_output: 'write config', tool_name: 'ssh.write_file', tool_input: '{"path":"/tmp/a"}', tool_output: '', risk: AICommandRisk.AICommandRiskModify, approval_status: AIAgentApprovalStatus.AIAgentApprovalPending, error: '', created_at: '', updated_at: '' }] })]
    __registerHandler(listCall, async () => tasks)
    __registerHandler(approveCall, approve)
    render(<AIAgentSessionPanel sessionID={9} sessionName="prod" />)
    await userEvent.click(await screen.findByRole('button', { name: '批准任务' }))
    expect(approve).toHaveBeenCalledWith(1, 4, true)
    await userEvent.click(screen.getByRole('button', { name: '拒绝任务' }))
    expect(approve).toHaveBeenCalledWith(1, 4, false)
  })

  it('deletes a task after confirmation', async () => {
    const remove = vi.fn(async () => undefined)
    __registerHandler(listCall, async () => [createTask({ status: AIAgentTaskStatus.AIAgentTaskCompleted })])
    __registerHandler(deleteCall, remove)
    render(<AIAgentSessionPanel sessionID={9} sessionName="prod" />)
    await userEvent.click(await screen.findByRole('button', { name: '删除任务' }))
    await waitFor(() => expect(requestConfirm).toHaveBeenCalled())
    expect(remove).toHaveBeenCalledWith(1)
  })

  it('retries a failed task with its original parameters', async () => {
    const retry = vi.fn(async () => {
      const next = createTask({ id: 2, status: AIAgentTaskStatus.AIAgentTaskRunning, prompt: 'retried task' })
      return next
    })
    __registerHandler(listCall, async () => [createTask({ status: AIAgentTaskStatus.AIAgentTaskFailed, error: 'boom' })])
    __registerHandler(retryCall, retry)
    render(<AIAgentSessionPanel sessionID={9} sessionName="prod" />)
    await userEvent.click(await screen.findByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledWith(1)
  })

  it('renders the task result with duration', async () => {
    __registerHandler(listCall, async () => [createTask({
      status: AIAgentTaskStatus.AIAgentTaskCompleted,
      result: 'disk usage collected',
      started_at: '2026-01-01T00:00:00Z',
      finished_at: '2026-01-01T00:00:05Z',
    })])
    render(<AIAgentSessionPanel sessionID={9} sessionName="prod" />)
    expect(await screen.findByText('任务结果')).toBeInTheDocument()
    expect(screen.getByText('disk usage collected')).toBeInTheDocument()
    expect(screen.getByText('耗时 5s')).toBeInTheDocument()
  })
})

function createTask(changes: Partial<AIAgentTask> = {}) {
  return new AIAgentTask({ id: 1, session_id: 9, session_name: 'prod', engine: AIAgentEngine.AIAgentEngineNative, cli: AIAgentCLI.$zero, prompt: 'inspect', status: AIAgentTaskStatus.AIAgentTaskCompleted, step_count: 0, result: '', error: '', created_at: '', updated_at: '', started_at: null, finished_at: null, steps: [], ...changes })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
