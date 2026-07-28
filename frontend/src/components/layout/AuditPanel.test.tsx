import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const audit = vi.hoisted(() => ({
  enabled: vi.fn(), setEnabled: vi.fn(async () => {}), list: vi.fn(),
}))
vi.mock('@/lib/wails', () => ({ AuditService: { Enabled: audit.enabled, SetEnabled: audit.setEnabled, List: audit.list } }))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => ({ sessions: [{ id: '7', name: '生产服务器' }] }) }))

import { AuditPanel } from '@/components/layout/AuditPanel'
import { useToastStore } from '@/components/ui/toast'

describe('AuditPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToastStore.setState({ toasts: [] })
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
    await user.click(screen.getByRole('switch', { name: '启用审计日志' }))
    expect(audit.setEnabled).toHaveBeenCalledWith(false)
  })

  it('shows audit setting load failures inline without toast', async () => {
    audit.enabled.mockRejectedValueOnce(new Error('enabled failed'))
    render(<AuditPanel />)
    expect(await screen.findByText('enabled failed')).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('shows audit toggle failures inline without toast', async () => {
    const user = userEvent.setup()
    audit.setEnabled.mockRejectedValueOnce(new Error('toggle failed'))
    render(<AuditPanel />)
    await screen.findAllByText('SSH 连接')
    await user.click(screen.getByRole('switch', { name: '启用审计日志' }))
    expect(await screen.findByText('toggle failed')).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('does not submit audit toggles twice while the first request is pending', async () => {
    let resolveToggle: (() => void) | undefined
    audit.setEnabled.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveToggle = resolve }))
    render(<AuditPanel />)
    await screen.findAllByText('SSH 连接')
    const toggle = screen.getByRole('switch', { name: '启用审计日志' })

    fireEvent.click(toggle)
    toggle.removeAttribute('disabled')
    fireEvent.click(toggle)

    expect(audit.setEnabled).toHaveBeenCalledOnce()
    await act(async () => { resolveToggle?.() })
  })

  it('does not surface an old filter error after a newer result succeeds', async () => {
    const first = deferred<unknown[]>()
    const second = deferred<unknown[]>()
    audit.list.mockReset()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const user = userEvent.setup()
    render(<AuditPanel />)
    await waitFor(() => expect(audit.list).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('combobox', { name: '审计会话' }))
    await user.click(await screen.findByRole('option', { name: '生产服务器' }))
    await waitFor(() => expect(audit.list).toHaveBeenCalledTimes(2))
    await act(async () => { second.resolve([]) })
    await act(async () => { first.reject(new Error('stale filter failed')) })

    expect(screen.queryByText('stale filter failed')).not.toBeInTheDocument()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
