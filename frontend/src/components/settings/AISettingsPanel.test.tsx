import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Events } from '@wailsio/runtime'
import { AISettingsPanel } from '@/components/settings/AISettingsPanel'
import type { AISettingsController } from '@/hooks/useAISettings'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'
import {
  AIAgentCLI,
  AIAgentEngine,
  AIProviderType,
  AISearchMode,
  AISearchProvider,
  type AIProviderProfile,
  type AISettingsDashboard,
} from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

vi.mock('@/lib/confirmDialog', () => ({ requestConfirm: vi.fn(async () => true) }))

describe('AISettingsPanel', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers() })

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
    await vi.advanceTimersByTimeAsync(600)
    expect(controller.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ interaction: expect.objectContaining({ panel_width: 500, context_lines: 120, history_retention_days: 60, max_conversations: 200, stream_responses: false }) }), { quiet: true })
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
    await vi.advanceTimersByTimeAsync(600)
    expect(controller.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ search: expect.objectContaining({ enabled: true, mode: 'independent', provider: 'tavily', timeout_seconds: 20, max_results: 8, require_citations: false, api_key: 'search-secret' }) }), { quiet: true })
  })

  it('saves security policy patterns', async () => {
    const controller = aiController()
    const user = userEvent.setup()
    render(<AISettingsPanel controller={controller as never} />)
    await user.click(screen.getByRole('tab', { name: '安全配置' }))
    expect(screen.getByText('命令默认需要审批；写入超时会关闭目标终端，执行结果需人工确认。')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: '允许只读命令自动执行' }))
    await changeNumber(user, '命令写入超时（秒）', '90')
    await changeNumber(user, '最大输出字节', '131072')
    await changeNumber(user, '计划最多步骤', '8')
    await user.type(screen.getByLabelText('允许模式'), '^safe$')
    await user.type(screen.getByLabelText('禁止模式'), '^danger$')
    await user.type(screen.getByLabelText('脱敏模式'), 'token=.*')
    await vi.advanceTimersByTimeAsync(600)
    expect(controller.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ security: expect.objectContaining({ auto_execute_read_only: true, command_timeout_seconds: 90, max_output_bytes: 131072, max_plan_steps: 8, allow_patterns: ['^safe$'], deny_patterns: ['^danger$'], redaction_patterns: ['token=.*'] }) }), { quiet: true })
  })

  it('renders loading and failure states', () => {
    const loading = aiController(); loading.dashboard = null as never; loading.loading = true
    const { rerender } = render(<AISettingsPanel controller={loading as never} />)
    expect(screen.getByText('正在加载 AI 配置...')).toBeInTheDocument()
    loading.loading = false
    rerender(<AISettingsPanel controller={loading as never} />)
    expect(screen.getByText('AI 配置加载失败')).toBeInTheDocument()
  })

  it('keeps edits made while an earlier settings save resolves', async () => {
    const controller = aiController()
    const firstSave = deferredSave()
    controller.saveSettings = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValue(undefined)
    const view = render(<AISettingsPanel controller={controller as never} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: '交互配置' }))
    await changeNumber(user, '面板宽度', '500')
    await vi.advanceTimersByTimeAsync(450)
    await changeNumber(user, '面板宽度', '520')
    await act(async () => {
      firstSave.resolve()
      await firstSave.promise
      await Promise.resolve()
    })
    const echoed = {
      ...controller,
      dashboard: {
        ...controller.dashboard,
        settings: {
          ...controller.dashboard.settings,
          interaction: { ...controller.dashboard.settings.interaction, panel_width: 500 },
        },
      },
    }
    view.rerender(<AISettingsPanel controller={echoed as never} />)

    expect(screen.getByLabelText('面板宽度')).toHaveValue(520)
  })

  it('coalesces provider priority with pending AI settings edits', async () => {
    const controller = aiController()
    controller.dashboard.providers = [providerProfile(1, 'main')]
    controller.dashboard.settings.default_provider_id = 1
    const user = userEvent.setup()
    render(<AISettingsPanel controller={controller as never} />)

    await user.click(screen.getByRole('tab', { name: '交互配置' }))
    await changeNumber(user, '面板宽度', '500')
    await user.click(screen.getByRole('tab', { name: '提供商' }))
    await selectOption(user, '默认提供商', '未设置')
    await vi.advanceTimersByTimeAsync(600)

    expect(controller.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      default_provider_id: null,
      interaction: expect.objectContaining({ panel_width: 500 }),
    }), { quiet: true })
  })

  it('removes a deleted provider from the pending AI settings draft', async () => {
    const controller = aiController()
    controller.dashboard.providers = [providerProfile(1, 'main')]
    controller.dashboard.settings.default_provider_id = 1
    const user = userEvent.setup()
    render(<AISettingsPanel controller={controller as never} />)

    await user.click(screen.getByRole('tab', { name: '交互配置' }))
    await changeNumber(user, '面板宽度', '500')
    await user.click(screen.getByRole('tab', { name: '提供商' }))
    await user.click(screen.getByRole('button', { name: /main/ }))
    await user.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(controller.deleteProvider).toHaveBeenCalledWith(1))
    await vi.advanceTimersByTimeAsync(600)

    expect(controller.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      default_provider_id: null,
      interaction: expect.objectContaining({ panel_width: 500 }),
    }), { quiet: true })
  })

  it('pauses autosave during provider operations and resumes afterward', async () => {
    const controller = aiController()
    const user = userEvent.setup()
    const view = render(<AISettingsPanel controller={controller as never} />)

    await user.click(screen.getByRole('tab', { name: '交互配置' }))
    await changeNumber(user, '面板宽度', '500')
    view.rerender(<AISettingsPanel controller={{ ...controller, pending: 'provider-delete' } as never} />)
    await vi.advanceTimersByTimeAsync(600)

    expect(controller.saveSettings).not.toHaveBeenCalled()

    view.rerender(<AISettingsPanel controller={{ ...controller, pending: null } as never} />)
    await vi.advanceTimersByTimeAsync(600)

    expect(controller.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      interaction: expect.objectContaining({ panel_width: 500 }),
    }), { quiet: true })
  })

  it('clears a saved search API key without writing it twice', async () => {
    const controller = aiController()
    const save = deferredSave()
    controller.saveSettings = vi.fn(() => save.promise)
    const user = userEvent.setup()
    const view = render(<AISettingsPanel controller={controller as never} />)

    await user.click(screen.getByRole('tab', { name: '网络搜索' }))
    await user.type(screen.getByLabelText('搜索 API Key'), 'search-secret')
    await vi.advanceTimersByTimeAsync(450)
    expect(controller.saveSettings).toHaveBeenCalledOnce()

    const persisted = {
      ...controller,
      dashboard: {
        ...controller.dashboard,
        settings: {
          ...controller.dashboard.settings,
          search: { ...controller.dashboard.settings.search, credential_saved: true },
        },
      },
    }
    view.rerender(<AISettingsPanel controller={persisted as never} />)
    await act(async () => { save.resolve(); await save.promise; await Promise.resolve() })

    expect(screen.getByLabelText('搜索 API Key')).toHaveValue('')
    await vi.advanceTimersByTimeAsync(600)
    expect(controller.saveSettings).toHaveBeenCalledOnce()
  })

  it('redacts a pending search API key when the native settings window hides without writing it twice', async () => {
    const controller = aiController()
    const save = deferredSave()
    controller.saveSettings = vi.fn(() => save.promise)
    const user = userEvent.setup()
    render(<AISettingsPanel controller={controller as never} />)
    await user.click(screen.getByRole('tab', { name: '网络搜索' }))
    await user.type(screen.getByLabelText('搜索 API Key'), 'search-secret')

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(controller.saveSettings).toHaveBeenCalledOnce()
    expect(controller.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      search: expect.objectContaining({ api_key: 'search-secret' }),
    }), { quiet: true })
    expect(screen.getByLabelText('搜索 API Key')).toHaveValue('')
    await act(async () => { save.resolve(); await save.promise; await Promise.resolve() })
    await vi.advanceTimersByTimeAsync(600)
    expect(controller.saveSettings).toHaveBeenCalledOnce()
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

type TestAISettingsController = Omit<AISettingsController, 'dashboard'> & { dashboard: AISettingsDashboard }

function aiController(): TestAISettingsController {
  return {
    dashboard: { keychain_available: true, providers: [], settings: { default_provider_id: null, fallback_provider_id: null, interaction: { panel_width: 420, context_lines: 80, include_session_metadata: true, include_system_summary: true, stream_responses: true, auto_scroll: true, render_markdown: true, history_retention_days: 30, max_conversations: 100, agent: { default_engine: AIAgentEngine.AIAgentEngineNative, default_cli: AIAgentCLI.AIAgentCLICodex } }, search: { enabled: false, mode: AISearchMode.AISearchAuto, provider: AISearchProvider.AISearchProviderBrave, timeout_seconds: 10, max_results: 5, require_citations: true, credential_saved: false, credential_session_only: false }, security: { auto_execute_read_only: false, command_timeout_seconds: 60, max_output_bytes: 65536, max_plan_steps: 5, allow_patterns: [], deny_patterns: [], redaction_patterns: [] } } },
    agents: [], loading: false, pending: null, error: null, reload: vi.fn(), saveProvider: vi.fn(), deleteProvider: vi.fn(), testProvider: vi.fn(), saveSettings: vi.fn(async () => {}), detectAgents: vi.fn(async () => {}),
  }
}

function deferredSave() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function providerProfile(id: number, name: string): AIProviderProfile {
  return {
    id,
    name,
    provider: AIProviderType.AIProviderOpenAICompatible,
    base_url: 'https://api.openai.com/v1',
    default_model: 'gpt',
    enabled: true,
    credential_saved: true,
    credential_session_only: false,
    context_window_size: 0,
    skip_tls_verify: false,
    max_tokens: 0,
    temperature: null,
    top_p: null,
    frequency_penalty: null,
    presence_penalty: null,
    custom_headers: {},
    created_at: '',
    updated_at: '',
  }
}
