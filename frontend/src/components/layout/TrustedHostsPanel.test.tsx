import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrustedHostsPanel } from '@/components/layout/TrustedHostsPanel'
import { useToastStore } from '@/components/ui/toast'
import { Events } from '@wailsio/runtime'
import { syncDataChangedEvent } from '@/lib/syncDataReload'

const session = vi.hoisted(() => ({
  ListHostKeys: vi.fn(),
  DeleteHostKey: vi.fn(),
}))

vi.mock('@/lib/wails', () => ({ SessionService: session }))

describe('TrustedHostsPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useToastStore.setState({ toasts: [] })
    session.ListHostKeys.mockResolvedValue([{ line: 1, hosts: 'example.com', algorithm: 'ssh-ed25519', fingerprint: 'SHA256:test' }])
    session.DeleteHostKey.mockResolvedValue(undefined)
  })

  it('lists trusted host fingerprints', async () => {
    render(<TrustedHostsPanel />)
    expect(await screen.findByText('example.com')).toBeInTheDocument()
    expect(screen.getByText('ssh-ed25519 · SHA256:test')).toBeInTheDocument()
  })

  it('deletes a trusted host fingerprint after confirmation', async () => {
    const user = userEvent.setup()
    render(<TrustedHostsPanel />)
    await user.click(await screen.findByRole('button', { name: '删除 example.com 的主机指纹' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(session.DeleteHostKey).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.queryByText('example.com')).not.toBeInTheDocument())
  })

  it('surfaces delete failures inline without toast', async () => {
    session.DeleteHostKey.mockRejectedValueOnce(new Error('delete boom'))
    const user = userEvent.setup()
    render(<TrustedHostsPanel />)
    await user.click(await screen.findByRole('button', { name: '删除 example.com 的主机指纹' }))
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('删除主机指纹失败: delete boom')
    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('shows empty state when no host keys are trusted', async () => {
    session.ListHostKeys.mockResolvedValue([])
    render(<TrustedHostsPanel />)
    expect(await screen.findByText('尚未信任任何 SSH 主机。')).toBeInTheDocument()
  })

  it('reloads trusted hosts after synchronized data changes', async () => {
    session.ListHostKeys.mockResolvedValueOnce([]).mockResolvedValue([{ line: 2, hosts: 'db.internal', algorithm: 'ssh-ed25519', fingerprint: 'SHA256:db' }])
    render(<TrustedHostsPanel />)
    expect(await screen.findByText('尚未信任任何 SSH 主机。')).toBeInTheDocument()

    await waitFor(async () => { await Events.Emit(syncDataChangedEvent, { changed: true }) })

    expect(await screen.findByText('db.internal')).toBeInTheDocument()
  })
})
