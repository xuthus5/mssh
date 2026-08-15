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
const workspace = vi.hoisted(() => ({
  sessions: [] as any[],
  folders: [] as any[],
}))
const logger = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() }))

vi.mock('@/lib/wails', () => ({ SessionService: session }))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => workspace }))
vi.mock('@/lib/logger', () => ({ logger }))

const sessionFixture = {
  id: '1', name: 'web-01', host: '10.0.0.1', port: 22, username: 'root',
  authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: 'f1',
  environment: { id: 'e1', name: '生产', colorToken: 'blue', sortOrder: 0, sessionCount: 1 },
  project: { id: 'p1', name: 'MSSH', code: 'MSSH', description: '', sortOrder: 0, sessionCount: 1 },
  tags: [{ id: 't1', name: 'Linux', colorToken: 'green', sessionCount: 1 }],
}

const hostFixture = { line: 1, hosts: '10.0.0.1:22', algorithm: 'ssh-ed25519', fingerprint: 'SHA256:test' }

describe('TrustedHostsPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useToastStore.setState({ toasts: [] })
    Object.assign(workspace, { sessions: [], folders: [] })
    session.ListHostKeys.mockResolvedValue([hostFixture])
    session.DeleteHostKey.mockResolvedValue(undefined)
  })

  it('lists trusted host fingerprints and matched session info', async () => {
    Object.assign(workspace, { sessions: [sessionFixture], folders: [{ id: 'f1', name: '生产环境', parentId: null, isDefault: true }] })
    render(<TrustedHostsPanel />)
    expect(await screen.findByText('10.0.0.1:22')).toBeInTheDocument()
    expect(screen.getByText('web-01')).toBeInTheDocument()
    expect(screen.getByText('root')).toBeInTheDocument()
    expect(screen.getByText('生产环境')).toBeInTheDocument()
    expect(screen.getByText('生产')).toBeInTheDocument()
    expect(screen.getByText('MSSH')).toBeInTheDocument()
    expect(screen.getByText('Linux')).toBeInTheDocument()
    expect(screen.getByText('SHA256:test')).toBeInTheDocument()
  })

  it('shows unlinked label when no session matches', async () => {
    render(<TrustedHostsPanel />)
    expect(await screen.findByText('10.0.0.1:22')).toBeInTheDocument()
    expect(screen.getByText('未关联会话')).toBeInTheDocument()
  })

  it('searches by host, session name, and fingerprint', async () => {
    Object.assign(workspace, { sessions: [sessionFixture] })
    const user = userEvent.setup()
    render(<TrustedHostsPanel />)
    await screen.findByText('10.0.0.1:22')

    await user.type(screen.getByPlaceholderText('搜索主机、会话、分组或指纹...'), 'web-01')
    expect(screen.getByText('10.0.0.1:22')).toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText('搜索主机、会话、分组或指纹...'))
    await user.type(screen.getByPlaceholderText('搜索主机、会话、分组或指纹...'), '不存在的节点')
    expect(screen.getByText('没有匹配的已信任主机。')).toBeInTheDocument()
    expect(screen.queryByText('10.0.0.1:22')).not.toBeInTheDocument()
  })

  it('deletes a trusted host fingerprint after confirmation', async () => {
    const user = userEvent.setup()
    render(<TrustedHostsPanel />)
    await user.click(await screen.findByRole('button', { name: '删除 10.0.0.1:22 的主机指纹' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(session.DeleteHostKey).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.queryByText('10.0.0.1:22')).not.toBeInTheDocument())
  })

  it('surfaces delete failures inline without toast', async () => {
    session.DeleteHostKey.mockRejectedValueOnce(new Error('delete boom'))
    const user = userEvent.setup()
    render(<TrustedHostsPanel />)
    await user.click(await screen.findByRole('button', { name: '删除 10.0.0.1:22 的主机指纹' }))
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('删除主机指纹失败: delete boom')
    expect(screen.getByText('10.0.0.1:22')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('shows empty state when no host keys are trusted', async () => {
    session.ListHostKeys.mockResolvedValue([])
    render(<TrustedHostsPanel />)
    expect(await screen.findByText('尚未信任任何 SSH 主机。')).toBeInTheDocument()
  })

  it('reloads trusted hosts after synchronized data changes', async () => {
    session.ListHostKeys.mockResolvedValueOnce([]).mockResolvedValue([{ line: 2, hosts: 'db.internal:22', algorithm: 'ssh-ed25519', fingerprint: 'SHA256:db' }])
    render(<TrustedHostsPanel />)
    expect(await screen.findByText('尚未信任任何 SSH 主机。')).toBeInTheDocument()

    await waitFor(async () => { await Events.Emit(syncDataChangedEvent, { changed: true }) })

    expect(await screen.findByText('db.internal:22')).toBeInTheDocument()
  })
})
