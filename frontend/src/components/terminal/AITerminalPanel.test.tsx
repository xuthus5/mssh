import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const ai = vi.hoisted(() => ({
  dashboard: vi.fn(), listConversations: vi.fn(), listMessages: vi.fn(),
  chat: vi.fn(), executeCommand: vi.fn(),
}))

vi.mock('@/lib/wails', () => ({ AIService: {
  Dashboard: ai.dashboard, ListConversations: ai.listConversations, ListMessages: ai.listMessages,
  Chat: ai.chat, ExecuteCommand: ai.executeCommand,
} }))

import { AITerminalPanel } from '@/components/terminal/AITerminalPanel'
import { useAppStore } from '@/store/appStore'

describe('AITerminalPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    ai.dashboard.mockResolvedValue(aiDashboard())
    ai.listConversations.mockResolvedValue([])
    ai.listMessages.mockResolvedValue([])
    ai.chat.mockResolvedValue({ conversation_id: 9, answer: '建议先检查服务', provider_id: 1, citations: [], commands: [{ command: 'systemctl status nginx', purpose: '检查服务', risk: 'read_only', blocked: false, blocked_reason: '', can_auto_execute: false, requires_confirmation: true }] })
    ai.executeCommand.mockResolvedValue(undefined)
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

  it('loads history, enables search, handles citations and closes', async () => {
    const onClose = vi.fn()
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
    expect(await screen.findByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://example.com')
    expect(screen.getByText('高风险')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '审批并执行' })).not.toBeInTheDocument()
    expect(ai.chat).toHaveBeenCalledWith(expect.objectContaining({ use_search: true, conversation_id: 3 }))
    await user.click(screen.getByRole('button', { name: '关闭 AI 面板' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows load and chat errors', async () => {
    ai.dashboard.mockRejectedValueOnce(new Error('dashboard failed'))
    const { unmount } = render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    expect(await screen.findByText('dashboard failed')).toBeInTheDocument()
    unmount()
    ai.dashboard.mockResolvedValue(aiDashboard())
    ai.chat.mockRejectedValueOnce(new Error('chat failed'))
    render(<AITerminalPanel terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('描述要排查或执行的运维任务'), '失败测试')
    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(await screen.findByText('chat failed')).toBeInTheDocument()
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
})

function terminalWithLines(lines: string[]) {
  return { buffer: { active: { length: lines.length, getLine: (index: number) => ({ translateToString: () => lines[index] }) } } }
}

function aiDashboard() {
  return { keychain_available: true, providers: [{ id: 1, name: 'main', provider: 'openai_compatible', base_url: '', default_model: 'model', enabled: true, credential_saved: true, credential_session_only: false, created_at: '', updated_at: '' }], settings: { default_provider_id: 1, fallback_provider_id: null, interaction: { panel_width: 420, context_lines: 80, include_session_metadata: true, include_system_summary: true, stream_responses: true, auto_scroll: true, render_markdown: true, history_retention_days: 30, max_conversations: 100 }, search: { enabled: false, mode: 'auto', provider: 'brave', timeout_seconds: 10, max_results: 5, require_citations: true, credential_saved: false, credential_session_only: false }, security: { auto_execute_read_only: false, command_timeout_seconds: 60, max_output_bytes: 65536, max_plan_steps: 5, allow_patterns: [], deny_patterns: [], redaction_patterns: [] } } }
}
