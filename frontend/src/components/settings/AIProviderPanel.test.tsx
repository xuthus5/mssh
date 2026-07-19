import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AIProviderPanel } from '@/components/settings/AIProviderPanel'

describe('AIProviderPanel', () => {
  it('edits, tests, deletes and changes provider priority', async () => {
    const controller = providerController()
    const user = userEvent.setup()
    render(<AIProviderPanel controller={controller as never} />)
    await user.click(screen.getByRole('button', { name: /main/ }))
    await selectOption(user, '类型', 'Ollama')
    expect(screen.getByLabelText('Base URL')).toHaveValue('http://127.0.0.1:11434')
    await user.clear(screen.getByLabelText('名称')); await user.type(screen.getByLabelText('名称'), 'local')
    await user.clear(screen.getByLabelText('默认模型')); await user.type(screen.getByLabelText('默认模型'), 'qwen')
    await user.type(screen.getByLabelText('API Key'), 'secret')
    await user.click(screen.getByRole('switch', { name: '启用此提供商' }))
    await user.click(screen.getByRole('button', { name: '保存提供商' }))
    expect(controller.saveProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'local', provider: 'ollama', default_model: 'qwen', enabled: false }))
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(controller.testProvider).toHaveBeenCalledWith(1)
    expect(controller.deleteProvider).toHaveBeenCalledWith(1)
    await selectOption(user, '默认提供商', '未设置')
    await selectOption(user, '故障回退', 'main')
    expect(controller.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ default_provider_id: null }))
    expect(controller.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ fallback_provider_id: 1 }))
  })

  it('creates a new provider from the empty editor', async () => {
    const controller = providerController()
    const user = userEvent.setup()
    render(<AIProviderPanel controller={controller as never} />)
    await user.click(screen.getByRole('button', { name: '新增提供商' }))
    await user.type(screen.getByLabelText('名称'), 'new provider')
    await user.type(screen.getByLabelText('默认模型'), 'model')
    await user.click(screen.getByRole('button', { name: '保存提供商' }))
    expect(controller.saveProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 0, name: 'new provider' }))
  })
})

async function selectOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

function providerController() {
  const profile = { id: 1, name: 'main', provider: 'openai_compatible', base_url: 'https://api.openai.com/v1', default_model: 'gpt', enabled: true, credential_saved: true, credential_session_only: false, created_at: '', updated_at: '' }
  return { dashboard: { keychain_available: true, providers: [profile], settings: { default_provider_id: 1, fallback_provider_id: null, interaction: { panel_width: 420, context_lines: 80, include_session_metadata: true, include_system_summary: true, stream_responses: true, auto_scroll: true, render_markdown: true, history_retention_days: 30, max_conversations: 100 }, search: { enabled: false, mode: 'auto', provider: 'brave', timeout_seconds: 10, max_results: 5, require_citations: true }, security: { auto_execute_read_only: false, command_timeout_seconds: 60, max_output_bytes: 65536, max_plan_steps: 5, allow_patterns: [], deny_patterns: [], redaction_patterns: [] } } }, pending: null, saveProvider: vi.fn(async (input) => ({ ...profile, ...input, id: input.id || 2 })), deleteProvider: vi.fn(async () => {}), testProvider: vi.fn(async () => {}), saveSettings: vi.fn(async () => {}) }
}
