import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { AIProviderPanel } from '@/components/settings/AIProviderPanel'
import { requestConfirm } from '@/lib/confirmDialog'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'

vi.mock('@/lib/confirmDialog', () => ({ requestConfirm: vi.fn(async () => true) }))

describe('AIProviderPanel', () => {
  beforeEach(() => {
    vi.mocked(requestConfirm).mockReset().mockResolvedValue(true)
  })

  it('edits and saves a provider', async () => {
    const controller = providerController()
    const user = userEvent.setup()
    controller.saveProvider = vi.fn(async (input) => ({ ...providerProfile(1, 'local'), ...input, name: 'normalized' }))
    renderProviderPanel(controller)
    await user.click(screen.getByRole('button', { name: /main/ }))
    await selectOption(user, '类型', 'Ollama')
    expect(screen.getByLabelText('Base URL')).toHaveValue('http://127.0.0.1:11434')
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'local' } })
    fireEvent.change(screen.getByLabelText('默认模型'), { target: { value: 'qwen' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('switch', { name: '启用此提供商' }))
    await user.click(screen.getByRole('button', { name: '保存提供商' }))

    await waitFor(() => expect(controller.saveProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'local', provider: 'ollama', default_model: 'qwen', enabled: false })))
    await waitFor(() => expect(screen.getByLabelText('名称')).toHaveValue('normalized'))
  })

  it('tests and deletes a provider', async () => {
    const controller = providerController()
    const { onProviderDeleted } = renderProviderPanel(controller)
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    await waitFor(() => expect(controller.testProvider).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByRole('button', { name: '删除' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(controller.deleteProvider).toHaveBeenCalledWith(1))
    expect(onProviderDeleted).toHaveBeenCalledWith(1)
  })

  it('changes provider priority', async () => {
    const controller = providerController()
    controller.dashboard.providers.push(providerProfile(2, 'backup'))
    const user = userEvent.setup()
    const { onPriorityChange } = renderProviderPanel(controller)
    await selectOption(user, '默认提供商', '未设置')
    await selectOption(user, '故障回退', 'backup')

    expect(onPriorityChange).toHaveBeenCalledWith({ default_provider_id: null })
    expect(onPriorityChange).toHaveBeenCalledWith({ fallback_provider_id: 2 })
    expect(controller.saveSettings).not.toHaveBeenCalled()
  })

  it('disables inactive and duplicate priority options', async () => {
    const controller = providerController()
    controller.dashboard.providers.push({ ...providerProfile(2, 'disabled'), enabled: false })
    renderProviderPanel(controller)
    await userEvent.click(screen.getByRole('combobox', { name: '故障回退' }))
    expect(await screen.findByRole('option', { name: 'main' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: 'disabled（未启用）' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not delete provider when confirmation is cancelled', async () => {
    vi.mocked(requestConfirm).mockResolvedValue(false)
    const controller = providerController()
    renderProviderPanel(controller)
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(requestConfirm).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: '删除' })).toBeEnabled())
    expect(controller.deleteProvider).not.toHaveBeenCalled()
  })

  it('creates a new provider from the empty editor', async () => {
    const controller = providerController()
    const user = userEvent.setup()
    renderProviderPanel(controller)
    await user.click(screen.getByRole('button', { name: '新增提供商' }))
    await user.type(screen.getByLabelText('名称'), 'new provider')
    await user.type(screen.getByLabelText('默认模型'), 'model')
    await user.click(screen.getByRole('button', { name: '保存提供商' }))
    expect(controller.saveProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 0, name: 'new provider' }))
  })

  it('shows the controller error when provider save fails validation', async () => {
    const controller = providerController()
    controller.error = 'AI provider URL must use HTTPS unless it is local'
    controller.saveProvider = vi.fn(async () => { throw new Error('AI provider URL must use HTTPS unless it is local') })
    renderProviderPanel(controller)
    expect(await screen.findByRole('alert')).toHaveTextContent('AI provider URL must use HTTPS unless it is local')
  })

  it('does not switch back when an old provider save resolves late', async () => {
    let resolveSave: ((profile: ReturnType<typeof providerProfile>) => void) | undefined
    const controller = providerController()
    controller.dashboard.providers.push(providerProfile(2, 'backup'))
    controller.saveProvider = vi.fn(() => new Promise((resolve) => { resolveSave = resolve }))
    renderProviderPanel(controller)
    await userEvent.click(screen.getByRole('button', { name: /main/ }))
    await userEvent.click(screen.getByRole('button', { name: '保存提供商' }))
    await userEvent.click(screen.getByRole('button', { name: /backup/ }))

    await act(async () => { resolveSave?.(providerProfile(1, 'main')) })

    expect(screen.getByLabelText('名称')).toHaveValue('backup')
  })

  it('does not clear a new provider target after an old delete finishes', async () => {
    let resolveDelete: (() => void) | undefined
    const controller = providerController()
    controller.dashboard.providers.push(providerProfile(2, 'backup'))
    controller.deleteProvider = vi.fn(() => new Promise<void>((resolve) => { resolveDelete = resolve }))
    renderProviderPanel(controller)
    await userEvent.click(screen.getByRole('button', { name: /main/ }))
    await userEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(controller.deleteProvider).toHaveBeenCalledWith(1))
    await userEvent.click(screen.getByRole('button', { name: /backup/ }))

    await act(async () => { resolveDelete?.() })

    expect(screen.getByLabelText('名称')).toHaveValue('backup')
  })

  it('preserves edits made while a provider save is pending', async () => {
    let resolveSave: ((profile: ReturnType<typeof providerProfile>) => void) | undefined
    const controller = providerController()
    controller.saveProvider = vi.fn(() => new Promise((resolve) => { resolveSave = resolve }))
    renderProviderPanel(controller)
    await userEvent.click(screen.getByRole('button', { name: /main/ }))
    await userEvent.click(screen.getByRole('button', { name: '保存提供商' }))
    await userEvent.clear(screen.getByLabelText('名称'))
    await userEvent.type(screen.getByLabelText('名称'), 'unsaved edit')

    await act(async () => { resolveSave?.(providerProfile(1, 'saved response')) })

    expect(screen.getByLabelText('名称')).toHaveValue('unsaved edit')
  })

  it('locks competing provider actions while saving', async () => {
    const save = deferred<ReturnType<typeof providerProfile>>()
    const controller = providerController()
    controller.saveProvider = vi.fn(() => save.promise)
    renderProviderPanel(controller)
    await userEvent.click(screen.getByRole('button', { name: /main/ }))
    await userEvent.click(screen.getByRole('button', { name: '保存提供商' }))

    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存提供商' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(controller.deleteProvider).not.toHaveBeenCalled()
    await act(async () => { save.resolve(providerProfile(1, 'main')); await save.promise })
  })

  it('does not open delete confirmation during a same-frame provider save', async () => {
    const save = deferred<ReturnType<typeof providerProfile>>()
    const controller = providerController()
    controller.saveProvider = vi.fn(() => save.promise)
    renderProviderPanel(controller)
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    const saveButton = screen.getByRole('button', { name: '保存提供商' })
    const deleteButton = screen.getByRole('button', { name: '删除' })

    act(() => {
      fireEvent.click(saveButton)
      fireEvent.click(deleteButton)
    })

    expect(requestConfirm).not.toHaveBeenCalled()
    expect(controller.deleteProvider).not.toHaveBeenCalled()
    await act(async () => { save.resolve(providerProfile(1, 'main')); await save.promise })
  })

  it('discards unsaved provider secrets and restores the saved profile when the settings window hides', async () => {
    const controller = providerController()
    renderProviderPanel(controller)
    await userEvent.click(screen.getByRole('button', { name: /main/ }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'unsaved name' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'secret-key' } })

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.getByLabelText('名称')).toHaveValue('main')
    expect(screen.getByLabelText('API Key')).toHaveValue('')
  })

  it('ignores a provider save response that arrives after the settings window hides', async () => {
    const save = deferred<ReturnType<typeof providerProfile>>()
    const controller = providerController()
    controller.saveProvider = vi.fn(() => save.promise)
    renderProviderPanel(controller)
    await userEvent.click(screen.getByRole('button', { name: /main/ }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'unsaved name' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'secret-key' } })
    await userEvent.click(screen.getByRole('button', { name: '保存提供商' }))

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })
    await act(async () => { save.resolve(providerProfile(1, 'late response')); await save.promise })

    expect(screen.getByLabelText('名称')).toHaveValue('main')
    expect(screen.getByLabelText('API Key')).toHaveValue('')
  })
})

async function selectOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

function providerController() {
  const profile = providerProfile(1, 'main')
  return { dashboard: { keychain_available: true, providers: [profile], settings: { default_provider_id: 1, fallback_provider_id: null, interaction: { panel_width: 420, context_lines: 80, include_session_metadata: true, include_system_summary: true, stream_responses: true, auto_scroll: true, render_markdown: true, history_retention_days: 30, max_conversations: 100 }, search: { enabled: false, mode: 'auto', provider: 'brave', timeout_seconds: 10, max_results: 5, require_citations: true }, security: { auto_execute_read_only: false, command_timeout_seconds: 60, max_output_bytes: 65536, max_plan_steps: 5, allow_patterns: [], deny_patterns: [], redaction_patterns: [] } } }, pending: null, error: null as string | null, saveProvider: vi.fn(async (input) => ({ ...profile, ...input, id: input.id || 2 })), deleteProvider: vi.fn(async () => {}), testProvider: vi.fn(async () => {}), saveSettings: vi.fn(async () => {}) }
}

function renderProviderPanel(controller: ReturnType<typeof providerController>) {
  const onPriorityChange = vi.fn()
  const onProviderDeleted = vi.fn()
  const view = render(
    <AIProviderPanel
      controller={controller as never}
      priorities={{
        default_provider_id: controller.dashboard.settings.default_provider_id,
        fallback_provider_id: controller.dashboard.settings.fallback_provider_id,
      }}
      onPriorityChange={onPriorityChange}
      onProviderDeleted={onProviderDeleted}
    />,
  )
  return { ...view, onPriorityChange, onProviderDeleted }
}

function providerProfile(id: number, name: string) {
  return { id, name, provider: 'openai_compatible', base_url: 'https://api.openai.com/v1', default_model: 'gpt', enabled: true, credential_saved: true, credential_session_only: false, created_at: '', updated_at: '' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
