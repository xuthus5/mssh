import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AIConversation, AIMessage } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { __clearHandlers, __emitEvent } from '@/test/__mocks__/wails-runtime'
import { AI_CONFIGURATION_CHANGED_EVENT } from '@/lib/settingsWindowEvents'

const ai = vi.hoisted(() => ({
  dashboard: vi.fn(), listConversations: vi.fn(), listMessages: vi.fn(),
  chat: vi.fn(), executeCommand: vi.fn(), listAgentTasks: vi.fn(),
}))
const scrollIntoView = vi.fn()

vi.mock('@/lib/wails', () => ({ AIService: {
  Dashboard: ai.dashboard, ListConversations: ai.listConversations, ListMessages: ai.listMessages,
  Chat: ai.chat, ExecuteCommand: ai.executeCommand, ListAgentTasks: ai.listAgentTasks,
} }))

import { AITerminalPanel } from '@/components/terminal/AITerminalPanel'
import { useToastStore } from '@/components/ui/toast'
import { useAppStore } from '@/store/appStore'
import { resetAIConversationMutationCoordinator } from '@/lib/aiConversationMutationCoordinator'

describe('AITerminalPanel', () => {
  beforeEach(() => {
    __clearHandlers()
    localStorage.clear()
    resetAIConversationMutationCoordinator()
    useToastStore.setState({ toasts: [] })
    ai.dashboard.mockResolvedValue(aiDashboard())
    ai.listConversations.mockResolvedValue([])
    ai.listMessages.mockResolvedValue([])
    ai.chat.mockResolvedValue({ conversation_id: 9, answer: '建议先检查服务', provider_id: 1, citations: [], commands: [{ command: 'systemctl status nginx', purpose: '检查服务', risk: 'read_only', blocked: false, blocked_reason: '', can_auto_execute: false, requires_confirmation: true }] })
    ai.executeCommand.mockResolvedValue(undefined)
    ai.listAgentTasks.mockResolvedValue([])
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    scrollIntoView.mockClear()
    useAppStore.setState({ terminalPool: new Map([['term-1', { terminal: terminalWithLines(['old', 'current']) as never, lastUsed: 0 }]]) })
  })
  afterEach(() => { useAppStore.setState({ terminalPool: new Map() }); vi.clearAllMocks() })

  it('sends terminal context and executes only after approval', async () => {
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await waitFor(() => expect(ai.dashboard).toHaveBeenCalled())
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '检查 nginx')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    await waitFor(() => expect(ai.chat).toHaveBeenCalledWith(expect.objectContaining({ session_id: 7, terminal_id: 'term-1', terminal_context: 'old\ncurrent' })))
    expect(ai.executeCommand).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: '审批并执行' }))
    expect(ai.executeCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'systemctl status nginx', approved: true }))
  })

  it('switches between chat and Agent task modes', async () => {
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Agent 任务' }))
    expect(await screen.findByPlaceholderText('描述要在 当前 SSH 会话 上完成的任务')).toBeInTheDocument()
    expect(ai.listAgentTasks).toHaveBeenCalledWith(7, 100)
    await user.click(screen.getByRole('button', { name: '对话' }))
    expect(screen.getByPlaceholderText('描述要排查或执行的运维任务')).toBeInTheDocument()
  })

  it('loads history, enables search, handles citations and closes', async () => {
    const onClose = vi.fn()
    ai.dashboard.mockResolvedValue(aiDashboard({ searchEnabled: true }))
    ai.listConversations.mockResolvedValue([{ id: 3, session_id: 7, title: '历史排查', created_at: '', updated_at: '' }])
    ai.listMessages.mockResolvedValue([{ id: 1, conversation_id: 3, role: 'user', content: '历史问题', created_at: '' }, { id: 2, conversation_id: 3, role: 'assistant', content: '历史回答', created_at: '' }])
    ai.chat.mockResolvedValue({ conversation_id: 3, answer: '参考资料', provider_id: 1, citations: [{ title: 'Docs', url: 'https://example.com', snippet: 'result' }], commands: [{ command: 'reboot', purpose: '重启', risk: 'blocked', blocked: true, blocked_reason: '高风险', can_auto_execute: false, requires_confirmation: true }] })
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={onClose} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '对话历史' }))
    await user.click(await screen.findByRole('button', { name: '历史排查' }))
    expect(await screen.findByText('历史回答')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: '网络搜索' }))
    const prompt = screen.getByPlaceholderText('描述要排查或执行的运维任务')
    await user.type(prompt, '查资料')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(await screen.findByRole('button', { name: 'Docs' })).toBeInTheDocument()
    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(screen.getByText('高风险')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '审批并执行' })).not.toBeInTheDocument()
    expect(ai.chat).toHaveBeenCalledWith(expect.objectContaining({ use_search: true, conversation_id: 3 }))
    await user.click(screen.getByRole('button', { name: '关闭 AI 面板' }))
    expect(onClose).toHaveBeenCalled()
  })

  it.each([
    { name: 'disabled provider', searchEnabled: false, searchMode: 'auto' },
    { name: 'disabled mode', searchEnabled: true, searchMode: 'disabled' },
  ])('blocks network search when $name makes it unavailable', async ({ searchEnabled, searchMode }) => {
    ai.dashboard.mockResolvedValue(aiDashboard({ searchEnabled, searchMode }))
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await waitFor(() => expect(ai.dashboard).toHaveBeenCalled())
    const search = screen.getByRole('switch', { name: '网络搜索' })

    await waitFor(() => expect(search).toHaveAttribute('aria-disabled', 'true'))
    await user.click(search)
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '不可搜索')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    await waitFor(() => expect(ai.chat).toHaveBeenCalled())
    expect(ai.chat).toHaveBeenCalledWith(expect.objectContaining({ use_search: false }))
  })

  it('clears an enabled search toggle when refreshed capability becomes unavailable', async () => {
    ai.dashboard
      .mockResolvedValueOnce(aiDashboard({ searchEnabled: true }))
      .mockResolvedValueOnce(aiDashboard({ searchEnabled: false }))
    ai.listConversations.mockRejectedValueOnce(new Error('history failed')).mockResolvedValueOnce([])
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    const search = screen.getByRole('switch', { name: '网络搜索' })
    await waitFor(() => expect(search).not.toHaveAttribute('aria-disabled', 'true'))
    await user.click(search)
    expect(search).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: '对话历史' }))
    await user.click(await screen.findByRole('button', { name: '重试' }))

    await waitFor(() => expect(search).toHaveAttribute('aria-disabled', 'true'))
    expect(search).toHaveAttribute('aria-checked', 'false')
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '降级后请求')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    await waitFor(() => expect(ai.chat).toHaveBeenCalled())
    expect(ai.chat).toHaveBeenCalledWith(expect.objectContaining({ use_search: false }))
  })

  it('scrolls new AI messages into view when auto-scroll is enabled', async () => {
    ai.dashboard.mockResolvedValue(aiDashboard({ autoScroll: true, contextLines: 81 }))
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    expect(await screen.findByText('81 行上下文')).toBeInTheDocument()
    scrollIntoView.mockClear()

    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '检查滚动')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    await screen.findByText('建议先检查服务')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end' })
  })

  it('leaves the message scroll position unchanged when auto-scroll is disabled', async () => {
    ai.dashboard.mockResolvedValue(aiDashboard({ autoScroll: false, contextLines: 82 }))
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    expect(await screen.findByText('82 行上下文')).toBeInTheDocument()
    scrollIntoView.mockClear()

    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '保持位置')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    await screen.findByText('建议先检查服务')
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('applies changed AI settings without clearing the active conversation', async () => {
    ai.dashboard
      .mockResolvedValueOnce(aiDashboard({ contextLines: 80, searchEnabled: true }))
      .mockResolvedValueOnce(aiDashboard({ contextLines: 120, searchEnabled: false }))
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    expect(await screen.findByText('80 行上下文')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '保留当前对话')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(await screen.findByText('建议先检查服务')).toBeInTheDocument()
    const conversationLoads = ai.listConversations.mock.calls.length

    act(() => __emitEvent(AI_CONFIGURATION_CHANGED_EVENT, { data: { changed: true } }))

    expect(await screen.findByText('120 行上下文')).toBeInTheDocument()
    expect(screen.getByText('建议先检查服务')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '网络搜索' })).toHaveAttribute('aria-disabled', 'true')
    expect(ai.listConversations).toHaveBeenCalledTimes(conversationLoads)
  })

  it('defers auto-scroll while hidden and catches up when shown again', async () => {
    const pending = deferred<ReturnType<typeof chatResponse>>()
    ai.chat.mockImplementationOnce(() => pending.promise)
    const view = render(<AITerminalPanel open terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await waitFor(() => expect(ai.dashboard).toHaveBeenCalled())
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '后台滚动')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    view.rerender(<AITerminalPanel open={false} terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    scrollIntoView.mockClear()
    await act(async () => { pending.resolve(chatResponse('后台完成')); await pending.promise })
    expect(scrollIntoView).not.toHaveBeenCalled()

    view.rerender(<AITerminalPanel open terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end' }))
  })

  it('shows load and chat errors inline without toast', async () => {
    ai.dashboard.mockRejectedValueOnce(new Error('dashboard failed'))
    const { unmount } = render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    expect(await screen.findByText(/加载 AI 面板失败/)).toBeInTheDocument()
    expect(screen.getByText(/dashboard failed/)).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
    unmount()
    useToastStore.setState({ toasts: [] })
    ai.dashboard.mockResolvedValue(aiDashboard())
    ai.chat.mockRejectedValueOnce(new Error('chat failed'))
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '失败测试')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(await screen.findByText('chat failed')).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('does not pretend empty history when panel load fails', async () => {
    ai.dashboard.mockRejectedValueOnce(new Error('dashboard failed'))
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '对话历史' }))
    expect(screen.queryByText('暂无对话')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('加载 AI 面板失败: dashboard failed')
    expect(screen.getByRole('alert')).not.toHaveTextContent('加载 AI 面板失败: 加载 AI 面板失败')
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('shows conversation history load failures inline without toast', async () => {
    ai.listConversations.mockResolvedValue([{ id: 3, session_id: 7, title: '历史排查', created_at: '', updated_at: '' }])
    ai.listMessages.mockRejectedValueOnce(new Error('messages failed'))
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '对话历史' }))
    await user.click(await screen.findByRole('button', { name: '历史排查' }))
    expect(await screen.findByText('messages failed')).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('ignores a stale panel load after switching sessions', async () => {
    const first = deferred<AIConversation[]>()
    const second = deferred<AIConversation[]>()
    ai.listConversations.mockImplementation((sessionID: number) => sessionID === 7 ? first.promise : second.promise)
    const view = render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await waitFor(() => expect(ai.listConversations).toHaveBeenCalledWith(7, 20))

    view.rerender(<AITerminalPanel terminalID="term-1" sessionID={8} onClose={vi.fn()} />)
    await waitFor(() => expect(ai.listConversations).toHaveBeenCalledWith(8, 20))
    await act(async () => { second.resolve([conversation(8, '新会话历史')]); await second.promise })
    await user.click(screen.getByRole('button', { name: '对话历史' }))
    expect(screen.getByRole('button', { name: '新会话历史' })).toBeInTheDocument()

    await act(async () => { first.resolve([conversation(7, '旧会话历史')]); await first.promise })
    expect(screen.queryByRole('button', { name: '旧会话历史' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新会话历史' })).toBeInTheDocument()
  })

  it('keeps the newest conversation when history clicks resolve out of order', async () => {
    const first = deferred<AIMessage[]>()
    const second = deferred<AIMessage[]>()
    ai.listConversations.mockResolvedValue([conversation(1, '第一条'), conversation(2, '第二条')])
    ai.listMessages.mockImplementation((id: number) => id === 1 ? first.promise : second.promise)
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '对话历史' }))
    await user.click(screen.getByRole('button', { name: '第一条' }))
    await user.click(screen.getByRole('button', { name: '第二条' }))
    await waitFor(() => expect(ai.listMessages).toHaveBeenCalledWith(2))

    await act(async () => { second.resolve([conversationMessage(2, '第二条内容')]); await second.promise })
    expect(await screen.findByText('第二条内容')).toBeInTheDocument()
    await act(async () => { first.resolve([conversationMessage(1, '第一条内容')]); await first.promise })
    expect(screen.queryByText('第一条内容')).not.toBeInTheDocument()
    expect(screen.getByText('第二条内容')).toBeInTheDocument()
  })

  it('shows command execution failures inline without toast', async () => {
    ai.executeCommand.mockRejectedValueOnce(new Error('exec failed'))
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await waitFor(() => expect(ai.dashboard).toHaveBeenCalled())
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '检查 nginx')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    await user.click(await screen.findByRole('button', { name: '审批并执行' }))
    expect(await screen.findByText('exec failed')).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('prevents duplicate approved command execution while pending', async () => {
    const pending = deferred<void>()
    ai.executeCommand.mockImplementationOnce(() => pending.promise)
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '检查 nginx')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    const execute = await screen.findByRole('button', { name: '审批并执行' })
    await user.click(execute)
    expect(screen.getByRole('button', { name: '执行中...' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '执行中...' }))
    expect(ai.executeCommand).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve() })
  })

  it('automatically executes trusted read-only proposals', async () => {
    ai.chat.mockResolvedValue({ conversation_id: 10, answer: '自动检查', provider_id: 1, citations: [], commands: [{ command: 'pwd', purpose: '查看目录', risk: 'read_only', blocked: false, blocked_reason: '', can_auto_execute: true, requires_confirmation: false }] })
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '查看目录')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    await waitFor(() => expect(ai.executeCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'pwd', approved: false })))
    expect(screen.queryByRole('button', { name: '审批并执行' })).not.toBeInTheDocument()
  })

  it('clears terminal-bound proposals when the active split changes', async () => {
    const view = render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '检查旧终端')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(await screen.findByText('建议先检查服务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '审批并执行' })).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '仅适用于旧终端')

    view.rerender(<AITerminalPanel terminalID="term-2" sessionID={7} onClose={vi.fn()} />)
    expect(screen.queryByText('建议先检查服务')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '审批并执行' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('描述要排查或执行的运维任务')).toHaveValue('')
  })

  it('cancels stale automatic execution after the active split changes', async () => {
    const response = { conversation_id: 10, answer: '旧终端回答', provider_id: 1, citations: [], commands: [{ command: 'pwd', purpose: '查看目录', risk: 'read_only', blocked: false, blocked_reason: '', can_auto_execute: true, requires_confirmation: false }] }
    const pending = deferred<typeof response>()
    ai.chat.mockImplementationOnce(() => pending.promise)
    const view = render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '检查旧终端')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    await waitFor(() => expect(ai.chat).toHaveBeenCalledWith(expect.objectContaining({ terminal_id: 'term-1' })))

    view.rerender(<AITerminalPanel terminalID="term-2" sessionID={7} onClose={vi.fn()} />)
    await act(async () => { pending.resolve(response); await pending.promise })
    expect(screen.queryByText('旧终端回答')).not.toBeInTheDocument()
    expect(ai.executeCommand).not.toHaveBeenCalled()
  })

  it('keeps the chat lease until an old terminal request settles', async () => {
    const oldResponse = deferred<ReturnType<typeof chatResponse>>()
    ai.chat
      .mockImplementationOnce(() => oldResponse.promise)
      .mockResolvedValueOnce(chatResponse('新终端回答'))
    const view = render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '检查旧终端')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(ai.chat).toHaveBeenCalledOnce()

    view.rerender(<AITerminalPanel terminalID="term-2" sessionID={7} onClose={vi.fn()} />)
    const prompt = screen.getByPlaceholderText('描述要排查或执行的运维任务')
    await user.type(prompt, '检查新终端')
    expect(screen.getByRole('button', { name: '发送问题' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(ai.chat).toHaveBeenCalledOnce()

    await act(async () => { oldResponse.resolve(chatResponse('旧终端回答')); await oldResponse.promise })
    expect(screen.queryByText('旧终端回答')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '发送问题' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(ai.chat).toHaveBeenCalledTimes(2)
    expect(ai.chat).toHaveBeenLastCalledWith(expect.objectContaining({ terminal_id: 'term-2' }))
  })

  it('keeps an in-flight chat mounted while the panel is hidden', async () => {
    const pending = deferred<ReturnType<typeof chatResponse>>()
    ai.chat.mockImplementationOnce(() => pending.promise)
    const view = render(<AITerminalPanel open terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '持续分析')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    view.rerender(<AITerminalPanel open={false} terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    expect(screen.getByTestId('ai-terminal-panel')).not.toBeVisible()
    view.rerender(<AITerminalPanel open terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: '发送问题' })).toBeDisabled()

    await act(async () => { pending.resolve(chatResponse('后台分析完成')); await pending.promise })
    expect(await screen.findByText('后台分析完成')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('AI 正在分析当前上下文...')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '发送问题' })).toBeDisabled()
  })
})

function chatResponse(answer: string) {
  return { conversation_id: 10, answer, provider_id: 1, citations: [], commands: [] }
}

function terminalWithLines(lines: string[]) {
  return { buffer: { active: { length: lines.length, getLine: (index: number) => ({ translateToString: () => lines[index] }) } } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function conversation(id: number, title: string): AIConversation {
  return { id, session_id: 7, title, created_at: '', updated_at: '' }
}

function conversationMessage(id: number, content: string): AIMessage {
  return { id, conversation_id: id, role: 'assistant', content, created_at: '' }
}

function aiDashboard(options: { autoScroll?: boolean; contextLines?: number; searchEnabled?: boolean; searchMode?: string } = {}) {
  return { keychain_available: true, providers: [{ id: 1, name: 'main', provider: 'openai_compatible', base_url: '', default_model: 'model', enabled: true, credential_saved: true, credential_session_only: false, context_window_size: 0, skip_tls_verify: false, max_tokens: 0, temperature: null, top_p: null, frequency_penalty: null, presence_penalty: null, custom_headers: {}, created_at: '', updated_at: '' }], settings: { default_provider_id: 1, fallback_provider_id: null, interaction: { panel_width: 420, context_lines: options.contextLines ?? 80, include_session_metadata: true, include_system_summary: true, stream_responses: true, auto_scroll: options.autoScroll ?? true, render_markdown: true, history_retention_days: 30, max_conversations: 100, agent: { default_engine: 'native', default_cli: 'codex' } }, search: { enabled: options.searchEnabled ?? false, mode: options.searchMode ?? 'auto', provider: 'brave', timeout_seconds: 10, max_results: 5, require_citations: true, credential_saved: false, credential_session_only: false }, security: { auto_execute_read_only: false, command_timeout_seconds: 60, max_output_bytes: 65536, max_plan_steps: 5, allow_patterns: [], deny_patterns: [], redaction_patterns: [] } } }
}
