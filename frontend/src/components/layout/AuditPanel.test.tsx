import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const audit = vi.hoisted(() => ({
  enabled: vi.fn(), setEnabled: vi.fn(async () => {}), list: vi.fn(),
}))
vi.mock('@/lib/wails', () => ({ AuditService: { Enabled: audit.enabled, SetEnabled: audit.setEnabled, List: audit.list } }))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => ({ sessions: [{ id: '7', name: '生产服务器' }] }) }))

import { AuditPanel } from '@/components/layout/AuditPanel'

describe('AuditPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    audit.enabled.mockResolvedValue(true)
    audit.list.mockResolvedValue([{ id: 1, action: 'connect', target_type: 'session', target_id: '7', session_id: 7, summary: 'SSH 连接', outcome: 'success', created_at: '2026-07-17T01:02:03Z' }])
  })

  it('loads enabled audit records and resolves session labels', async () => {
    render(<AuditPanel />)

    expect(await screen.findAllByText('SSH 连接')).toHaveLength(2)
    expect(screen.getByText('生产服务器')).toBeInTheDocument()
    expect(screen.getByText('成功')).toBeInTheDocument()
    expect(audit.list).toHaveBeenCalledWith(expect.objectContaining({ action: '', session_id: null, limit: 200 }))
  })

  it('updates filters and explicitly disables auditing', async () => {
    const user = userEvent.setup()
    render(<AuditPanel />)
    await screen.findAllByText('SSH 连接')

    await user.click(screen.getByRole('combobox', { name: '审计会话' }))
    await user.click(await screen.findByRole('option', { name: '生产服务器' }))
    await waitFor(() => expect(audit.list).toHaveBeenLastCalledWith(expect.objectContaining({ session_id: 7 })))
    await user.click(screen.getByRole('switch', { name: '启用企业审计' }))
    expect(audit.setEnabled).toHaveBeenCalledWith(false)
  })
})
