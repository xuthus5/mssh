import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AISettingsPanel } from '@/components/settings/AISettingsPanel'

describe('AISettingsPanel', () => {
  it('uses horizontal tabs and saves interaction changes', async () => {
    const controller = aiController()
    render(<AISettingsPanel controller={controller as never} />)
    const tablist = screen.getByRole('tablist')
    expect(tablist).toHaveAttribute('data-orientation', 'horizontal')
    expect(tablist).toHaveClass('mssh-tab-strip-scroll', 'overflow-x-auto', 'overflow-y-hidden')
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: '交互配置' }))
    const width = screen.getByLabelText('面板宽度')
    await user.clear(width)
    await user.type(width, '500')
    await changeNumber(user, '终端上下文行数', '120')
    await changeNumber(user, '历史保留天数', '60')
    await changeNumber(user, '最多对话数', '200')
    for (const label of ['附带会话信息', '附带系统摘要', '流式响应', '自动滚动', '渲染 Markdown']) await user.click(screen.getByRole('switch', { name: label }))
    await user.click(screen.getByRole('button', { name: '保存配置' }))
    expect(controller.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ interaction: expect.objectContaining({ panel_width: 500, context_lines: 120, history_retention_days: 60, max_conversations: 200, stream_responses: false }) }))
  })

  it('saves network search configuration', async () => {
    const controller = aiController()
    const user = userEvent.setup()
    render(<AISettingsPanel controller={controller as never} />)
    await user.click(screen.getByRole('tab', { name: '网络搜索' }))
    await user.click(screen.getByRole('switch', { name: '启用网络搜索' }))
    await selectOption(user, '搜索模式', '独立搜索')
    await selectOption(user, '搜索提供商', 'Tavily')
    await changeNumber(user, '超时（秒）', '20')
    await changeNumber(user, '最大结果数', '8')
    await user.type(screen.getByLabelText('搜索 API Key'), 'search-secret')
    await user.click(screen.getByRole('switch', { name: '要求回答提供引用' }))
    await user.click(screen.getByRole('button', { name: '保存配置' }))
    expect(controller.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ search: expect.objectContaining({ enabled: true, mode: 'independent', provider: 'tavily', timeout_seconds: 20, max_results: 8, require_citations: false, api_key: 'search-secret' }) }))
  })

  it('saves security policy patterns', async () => {
    const controller = aiController()
    const user = userEvent.setup()
    render(<AISettingsPanel controller={controller as never} />)
    await user.click(screen.getByRole('tab', { name: '安全配置' }))
    await user.click(screen.getByRole('switch', { name: '允许只读命令自动执行' }))
    await changeNumber(user, '命令超时（秒）', '90')
    await changeNumber(user, '最大输出字节', '131072')
    await changeNumber(user, '计划最多步骤', '8')
    await user.type(screen.getByLabelText('允许模式'), '^safe$')
    await user.type(screen.getByLabelText('禁止模式'), '^danger$')
    await user.type(screen.getByLabelText('脱敏模式'), 'token=.*')
    await user.click(screen.getByRole('button', { name: '保存配置' }))
    expect(controller.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ security: expect.objectContaining({ auto_execute_read_only: true, command_timeout_seconds: 90, max_output_bytes: 131072, max_plan_steps: 8, allow_patterns: ['^safe$'], deny_patterns: ['^danger$'], redaction_patterns: ['token=.*'] }) }))
  })

  it('renders loading and failure states', () => {
    const loading = aiController(); loading.dashboard = null as never; loading.loading = true
    const { rerender } = render(<AISettingsPanel controller={loading as never} />)
    expect(screen.getByText('正在加载 AI 配置...')).toBeInTheDocument()
    loading.loading = false
    rerender(<AISettingsPanel controller={loading as never} />)
    expect(screen.getByText('AI 配置加载失败')).toBeInTheDocument()
  })
})

async function changeNumber(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const input = screen.getByLabelText(label)
  await user.clear(input)
  await user.type(input, value)
}

async function selectOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

function aiController() {
  return {
    dashboard: { keychain_available: true, providers: [], settings: { default_provider_id: null, fallback_provider_id: null, interaction: { panel_width: 420, context_lines: 80, include_session_metadata: true, include_system_summary: true, stream_responses: true, auto_scroll: true, render_markdown: true, history_retention_days: 30, max_conversations: 100 }, search: { enabled: false, mode: 'auto', provider: 'brave', timeout_seconds: 10, max_results: 5, require_citations: true, credential_saved: false, credential_session_only: false }, security: { auto_execute_read_only: false, command_timeout_seconds: 60, max_output_bytes: 65536, max_plan_steps: 5, allow_patterns: [], deny_patterns: [], redaction_patterns: [] } } },
    agents: [], loading: false, pending: null, error: null, reload: vi.fn(), saveProvider: vi.fn(), deleteProvider: vi.fn(), testProvider: vi.fn(), saveSettings: vi.fn(async () => {}), detectAgents: vi.fn(async () => {}),
  }
}
