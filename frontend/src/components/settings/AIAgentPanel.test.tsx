import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AIAgentPanel } from '@/components/settings/AIAgentPanel'
import { OperationBusyError } from '@/lib/operationBusyError'
import { AIAgentCLI, AIAgentEngine } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

describe('AIAgentPanel', () => {
  it('detects and displays installed and missing agents', async () => {
    const detectAgents = vi.fn(async () => {})
    render(<AIAgentPanel controller={{ agents: [{ name: 'Codex', command: 'codex', installed: true, path: '/bin/codex', version: '1.0', error: '', detected_at: '' }, { name: 'Claude Code', command: 'claude', installed: false, path: '', version: '', error: '未找到', detected_at: '' }], pending: null, detectAgents } as never} />)
    expect(detectAgents).toHaveBeenCalled()
    expect(screen.getByText('1.0')).toBeInTheDocument()
    expect(screen.getByText('未找到')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重新检测' }))
    expect(detectAgents).toHaveBeenCalledTimes(2)
  })

  it('surfaces agent detection failures without unhandled rejections', async () => {
    const detectAgents = vi.fn(async () => { throw new Error('detect failed') })
    render(<AIAgentPanel controller={{ agents: [], pending: null, detectAgents } as never} />)
    await userEvent.click(screen.getByRole('button', { name: '重新检测' }))
    expect(detectAgents).toHaveBeenCalled()
  })

  it('waits for another AI operation before the initial detection', async () => {
    const detectAgents = vi.fn(async () => {})
    const view = render(<AIAgentPanel controller={{ agents: [], pending: 'provider-save', detectAgents } as never} />)

    expect(detectAgents).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '重新检测' })).toBeDisabled()

    view.rerender(<AIAgentPanel controller={{ agents: [], pending: null, detectAgents } as never} />)
    await waitFor(() => expect(detectAgents).toHaveBeenCalledOnce())
  })

  it('retries initial detection after a same-frame operation lease conflict', async () => {
    const detectAgents = vi.fn()
      .mockRejectedValueOnce(new OperationBusyError('busy'))
      .mockResolvedValue(undefined)
    const view = render(<AIAgentPanel controller={{ agents: [], pending: null, detectAgents } as never} />)
    await waitFor(() => expect(detectAgents).toHaveBeenCalledOnce())

    view.rerender(<AIAgentPanel controller={{ agents: [], pending: 'provider-save', detectAgents } as never} />)
    view.rerender(<AIAgentPanel controller={{ agents: [], pending: null, detectAgents } as never} />)

    await waitFor(() => expect(detectAgents).toHaveBeenCalledTimes(2))
  })

  it('updates the default engine and CLI selection', async () => {
    const detectAgents = vi.fn(async () => {})
    const update = vi.fn()
    const controller = { agents: [{ name: 'OpenCode', command: 'opencode', installed: true, path: '/bin/opencode', version: '1.0', error: '', detected_at: '' }], pending: null, detectAgents } as never
    const draft = { interaction: { panel_width: 420, context_lines: 80, include_session_metadata: true, include_system_summary: true, stream_responses: true, auto_scroll: true, render_markdown: true, history_retention_days: 30, max_conversations: 100, agent: { default_engine: AIAgentEngine.AIAgentEngineNative, default_cli: AIAgentCLI.AIAgentCLIOpenCode } } }
    const view = render(<AIAgentPanel controller={controller} draft={draft as never} update={update} />)
    await userEvent.click(screen.getByRole('button', { name: '本机 CLI' }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ interaction: expect.objectContaining({ agent: { default_engine: AIAgentEngine.AIAgentEngineLocalCLI, default_cli: AIAgentCLI.AIAgentCLIOpenCode } }) }))
    view.rerender(<AIAgentPanel controller={controller} draft={{ ...draft, interaction: { ...draft.interaction, agent: { ...draft.interaction.agent, default_engine: AIAgentEngine.AIAgentEngineLocalCLI } } } as never} update={update} />)
    expect(screen.getByRole('combobox', { name: '默认 Agent CLI' })).toHaveTextContent('OpenCode · 1.0')
  })

  it('toggles the Codex weak isolation switch', async () => {
    const detectAgents = vi.fn(async () => {})
    const update = vi.fn()
    const controller = { agents: [{ name: 'Codex', command: 'codex', installed: true, path: '/bin/codex', version: '1.0', error: '', detected_at: '' }], pending: null, detectAgents } as never
    const draft = { interaction: { panel_width: 420, context_lines: 80, include_session_metadata: true, include_system_summary: true, stream_responses: true, auto_scroll: true, render_markdown: true, history_retention_days: 30, max_conversations: 100, agent: { default_engine: AIAgentEngine.AIAgentEngineLocalCLI, default_cli: AIAgentCLI.AIAgentCLICodex, allow_codex: false } } }
    render(<AIAgentPanel controller={controller} draft={draft as never} update={update} />)
    await userEvent.click(screen.getByRole('switch', { name: '允许 Codex 弱隔离运行' }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      interaction: expect.objectContaining({
        agent: expect.objectContaining({ allow_codex: true }),
      }),
    }))
  })
})
