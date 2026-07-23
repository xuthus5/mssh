import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AIAgentPanel } from '@/components/settings/AIAgentPanel'

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
})
