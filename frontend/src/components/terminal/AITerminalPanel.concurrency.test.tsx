import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIMessage } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

const ai = vi.hoisted(() => ({
  dashboard: vi.fn(),
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  chat: vi.fn(),
  executeCommand: vi.fn(),
}))

vi.mock('@/lib/wails', () => ({ AIService: {
  Dashboard: ai.dashboard,
  ListConversations: ai.listConversations,
  ListMessages: ai.listMessages,
  Chat: ai.chat,
  ExecuteCommand: ai.executeCommand,
} }))

import { AITerminalPanel } from '@/components/terminal/AITerminalPanel'
import { emitAIConversationChanged, resetAIConversationMutationCoordinator } from '@/lib/aiConversationMutationCoordinator'
import { useAppStore } from '@/store/appStore'

describe('AITerminalPanel cross-panel conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAIConversationMutationCoordinator()
    ai.dashboard.mockResolvedValue(aiDashboard())
    ai.listConversations.mockResolvedValue([conversation(3, '共享排查'), conversation(4, '其他排查')])
    ai.listMessages.mockResolvedValue([])
    ai.executeCommand.mockResolvedValue(undefined)
    useAppStore.setState({ terminalPool: new Map([
      ['term-1', { terminal: terminalWithLines(['one']) as never, lastUsed: 0 }],
      ['term-2', { terminal: terminalWithLines(['two']) as never, lastUsed: 0 }],
    ]) })
  })

  it('single-flights one conversation and refreshes the other panel', async () => {
    const pending = deferred<ReturnType<typeof chatResponse>>()
    let chatCompleted = false
    ai.chat.mockImplementation(async () => {
      const response = await pending.promise
      chatCompleted = true
      return response
    })
    ai.listMessages.mockImplementation(async (id: number) => id === 3
      ? chatCompleted ? messages(3, ['历史内容', '第一个问题', '共享回答']) : messages(3, ['历史内容'])
      : [])
    render(<div><AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />
      <AITerminalPanel terminalID="term-2" sessionID={7} onClose={vi.fn()} /></div>)
    const panels = await screen.findAllByTestId('ai-terminal-panel')
    await selectConversation(panels[0], '共享排查')
    await selectConversation(panels[1], '共享排查')
    const firstPrompt = within(panels[0]).getByPlaceholderText('描述要排查或执行的运维任务')
    const secondPrompt = within(panels[1]).getByPlaceholderText('描述要排查或执行的运维任务')
    await userEvent.type(firstPrompt, '第一个问题')
    await userEvent.type(secondPrompt, '第二个问题')

    act(() => {
      fireEvent.click(within(panels[0]).getByRole('button', { name: '发送问题' }))
      fireEvent.click(within(panels[1]).getByRole('button', { name: '发送问题' }))
    })

    expect(ai.chat).toHaveBeenCalledOnce()
    expect(secondPrompt).toHaveValue('第二个问题')
    expect(await within(panels[1]).findByText('AI 对话正在处理另一条消息')).toBeInTheDocument()
    expect(within(panels[1]).getByRole('button', { name: '关闭 AI 面板' })).toBeEnabled()
    await act(async () => { pending.resolve(chatResponse('共享回答')); await pending.promise })
    await waitFor(() => expect(within(panels[0]).getByText('共享回答')).toBeInTheDocument())
    await waitFor(() => expect(within(panels[1]).getByText('共享回答')).toBeInTheDocument())
    expect(within(panels[1]).queryByText('AI 对话正在处理另一条消息')).not.toBeInTheDocument()
  })

  it('reloads active messages when the conversation catalog refresh fails', async () => {
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const panel = await screen.findByTestId('ai-terminal-panel')
    await selectConversation(panel, '共享排查')
    ai.listConversations.mockRejectedValueOnce(new Error('catalog failed'))
    ai.listMessages.mockResolvedValueOnce(messages(3, ['同步后的回答']))

    act(() => emitAIConversationChanged(7, 3, Symbol('external-panel')))

    expect(await within(panel).findByText('同步后的回答')).toBeInTheDocument()
    expect(within(panel).getByText('同步 AI 对话失败: catalog failed')).toBeInTheDocument()
  })

  it('does not let a late answer overwrite a newly selected conversation', async () => {
    const pending = deferred<ReturnType<typeof chatResponse>>()
    ai.chat.mockReturnValueOnce(pending.promise)
    ai.listMessages.mockImplementation(async (id: number) => id === 3
      ? messages(3, ['共享历史'])
      : messages(4, ['其他会话内容']))
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const panel = await screen.findByTestId('ai-terminal-panel')
    await selectConversation(panel, '共享排查')
    await userEvent.type(within(panel).getByPlaceholderText('描述要排查或执行的运维任务'), '保持后台发送')
    await userEvent.click(within(panel).getByRole('button', { name: '发送问题' }))
    await selectConversation(panel, '其他排查')
    expect(await within(panel).findByText('其他会话内容')).toBeInTheDocument()

    pending.resolve(chatResponse('不应覆盖'))
    await act(async () => { await pending.promise })

    expect(within(panel).queryByText('不应覆盖')).not.toBeInTheDocument()
    expect(within(panel).getByText('其他会话内容')).toBeInTheDocument()
    await waitFor(() => expect(within(panel).queryByText('AI 正在分析当前上下文...')).not.toBeInTheDocument())
  })
})

async function selectConversation(panel: HTMLElement, title: string) {
  const history = within(panel).getByRole('button', { name: '对话历史' })
  await userEvent.click(history)
  await userEvent.click(await within(panel).findByRole('button', { name: title }))
}

function messages(conversationID: number, contents: string[]): AIMessage[] {
  return contents.map((content, index) => ({
    id: index + 1, conversation_id: conversationID,
    role: index % 2 === 0 ? 'assistant' : 'user', content, created_at: '',
  }))
}

function conversation(id: number, title: string) {
  return { id, session_id: 7, title, created_at: '', updated_at: '' }
}

function chatResponse(answer: string) {
  return { conversation_id: 3, answer, provider_id: 1, citations: [], commands: [] }
}

function terminalWithLines(lines: string[]) {
  return { buffer: { active: { length: lines.length, getLine: (index: number) => ({ translateToString: () => lines[index] }) } } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function aiDashboard() {
  return { keychain_available: true, providers: [], settings: { default_provider_id: null, fallback_provider_id: null, interaction: { panel_width: 420, context_lines: 80, include_session_metadata: true, include_system_summary: true, stream_responses: true, auto_scroll: true, render_markdown: true, history_retention_days: 30, max_conversations: 100, agent: { default_engine: 'native', default_cli: 'codex' } }, search: { enabled: false, mode: 'auto', provider: 'brave', timeout_seconds: 10, max_results: 5, require_citations: true, credential_saved: false, credential_session_only: false }, security: { auto_execute_read_only: false, command_timeout_seconds: 60, max_output_bytes: 65536, max_plan_steps: 5, allow_patterns: [], deny_patterns: [], redaction_patterns: [] } } }
}
