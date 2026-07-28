import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionAssetFilterStore } from '@/store/sessionAssetFilterStore'

const state = vi.hoisted(() => ({
  folders: [] as any[],
  sessions: [] as any[],
  recentSessions: [] as any[],
  loading: false,
  error: '',
  environments: [] as any[], projects: [] as any[], tags: [] as any[],
  listFolders: vi.fn(),
  listSessions: vi.fn(),
  listRecentSessions: vi.fn(),
  connect: vi.fn(),
  deleteFolder: vi.fn(),
  deleteSession: vi.fn(),
  setDefaultFolder: vi.fn(),
  moveSession: vi.fn(),
  batchConnect: vi.fn(),
  batchExecuteMacro: vi.fn(),
  batchDeleteSessions: vi.fn(),
  listAssetCatalogs: vi.fn(), bulkSetEnvironment: vi.fn(), bulkSetProject: vi.fn(), bulkUpdateTags: vi.fn(),
  createEnvironment: vi.fn(), createProject: vi.fn(), createTag: vi.fn(), updateEnvironment: vi.fn(), updateProject: vi.fn(), updateTag: vi.fn(),
  deleteEnvironment: vi.fn(), deleteProject: vi.fn(), deleteTag: vi.fn(), reorderEnvironments: vi.fn(), reorderProjects: vi.fn(),
}))
const toast = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => state }))
vi.mock('@/components/ui/toast', () => ({ toast }))
vi.mock('@/lib/wails', () => ({
  SessionService: {
    SessionDeleteImpact: vi.fn(async () => ({ tunnels: 0, history: 0, recordings: 0, transfers: 0 })),
    SessionsDeleteImpact: vi.fn(async () => ({ tunnels: 0, history: 0, recordings: 0, transfers: 0 })),
  },
  MacroService: { List: vi.fn(async () => []) },
}))
vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react')
  return {
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: ({ render, children }: any) => React.cloneElement(render, {}, children),
    DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
    DropdownMenuGroup: ({ children }: any) => <div>{children}</div>,
    DropdownMenuItem: ({ children, onClick, disabled }: any) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
    DropdownMenuSub: ({ children }: any) => <div>{children}</div>,
    DropdownMenuSubContent: ({ children }: any) => <div>{children}</div>,
    DropdownMenuSubTrigger: ({ children }: any) => <span>{children}</span>,
  }
})
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null,
  AlertDialogAction: ({ children, onClick }: any) => <button type="button" onClick={onClick}>{children}</button>,
  AlertDialogCancel: ({ children }: any) => <button type="button">{children}</button>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
}))

import { SessionAssetCenter } from '@/components/session/SessionAssetCenter'

const folders = [
  { id: 'default', name: '默认分组', parentId: null, isDefault: true },
  { id: 'prod', name: '生产环境', parentId: null, isDefault: false },
]
const sessions = [
  session('one', '生产服务器', 'prod'),
  session('two', '测试服务器', 'default'),
]

describe('SessionAssetCenter behavior', () => {
  beforeEach(() => {
	useSessionAssetFilterStore.getState().resetFilters()
    Object.assign(state, { folders: [...folders], sessions: [...sessions], recentSessions: [{ ...sessions[0], lastConnectedAt: '2026-07-12T12:00:00Z', connectionCount: 3 }], environments: [], projects: [], tags: [], loading: false, error: '' })
    for (const value of Object.values(state)) if (typeof value === 'function' && 'mockReset' in value) value.mockReset().mockResolvedValue(undefined)
    toast.mockClear()
  })

  it('retries failed loads and renders loading rows', async () => {
    const user = userEvent.setup()
    state.error = 'load failed'
    const { container, rerender } = render(<SessionAssetCenter />)
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(state.listFolders).toHaveBeenCalled()
    expect(state.listSessions).toHaveBeenCalled()
    expect(state.listRecentSessions).toHaveBeenCalled()

    state.error = ''
    state.loading = true
    rerender(<SessionAssetCenter />)
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3)
  })

  it('connects, edits, moves, and deletes sessions', async () => {
    const user = userEvent.setup()
    const editSession = vi.fn()
    window.addEventListener('mssh:edit-session', editSession)
    render(<SessionAssetCenter />)

    await user.click(screen.getByRole('button', { name: '连接' }))
    await user.click(screen.getByRole('button', { name: '编辑' }))
    await user.click(screen.getByRole('button', { name: '默认分组' }))
    expect(state.connect).toHaveBeenCalledWith('one')
    expect(editSession).toHaveBeenCalled()
    expect(state.moveSession).toHaveBeenCalledWith('one', 'default')

    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('删除“生产服务器”？')
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(state.deleteSession).toHaveBeenCalledWith('one'))
    window.removeEventListener('mssh:edit-session', editSession)
  })

  it('opens, renames, defaults, and deletes folders', async () => {
    const user = userEvent.setup()
    const editFolder = vi.fn()
    window.addEventListener('mssh:edit-folder', editFolder)
    render(<SessionAssetCenter />)
    await user.click(screen.getByRole('tab', { name: /分组/ }))

    const prodRow = screen.getByRole('button', { name: '生产环境' }).closest('tr')
    expect(prodRow).not.toBeNull()
    await user.click(within(prodRow!).getByRole('button', { name: '重命名' }))
    await user.click(within(prodRow!).getByRole('button', { name: '设为默认' }))
    expect(editFolder).toHaveBeenCalled()
    expect(state.setDefaultFolder).toHaveBeenCalledWith('prod')

    await user.click(within(prodRow!).getByRole('button', { name: '删除' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('其中 1 个会话和 0 个子分组将迁移到默认分组。')
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(state.deleteFolder).toHaveBeenCalledWith('prod'))
    window.removeEventListener('mssh:edit-folder', editFolder)
  })

  it('filters nodes, handles external selection, and dispatches create events', async () => {
    const user = userEvent.setup()
    const newSession = vi.fn()
    const newFolder = vi.fn()
    window.addEventListener('mssh:new-session', newSession)
    window.addEventListener('mssh:new-folder', newFolder)
    render(<SessionAssetCenter />)

    await user.click(screen.getByRole('button', { name: /新建会话/ }))
    await user.click(screen.getByRole('button', { name: /新建分组目录/ }))
    expect(newSession).toHaveBeenCalled()
    expect(newFolder).toHaveBeenCalled()

    act(() => window.dispatchEvent(new CustomEvent('mssh:select-folder', { detail: 'prod' })))
    expect(screen.getAllByText('生产环境').length).toBeGreaterThan(0)
    expect(screen.getByText('生产服务器')).toBeInTheDocument()
    expect(screen.queryByText('测试服务器')).not.toBeInTheDocument()
    const searchInput = screen.getByRole('textbox', { name: '搜索所有节点' })
    await user.type(searchInput, 'missing')
    expect(screen.getByText('暂无会话节点')).toBeInTheDocument()
    await user.clear(searchInput)
    await user.click(screen.getByRole('button', { name: '所有节点' }))
    expect(screen.getByText('测试服务器')).toBeInTheDocument()

    window.removeEventListener('mssh:new-session', newSession)
    window.removeEventListener('mssh:new-folder', newFolder)
  })

  it('shows set-default failures as asset-center banner without toast', async () => {
    const user = userEvent.setup()
    state.setDefaultFolder.mockRejectedValueOnce(new Error('default failed'))
    render(<SessionAssetCenter />)
    await user.click(screen.getByRole('tab', { name: /分组/ }))
    const prodRow = screen.getByRole('button', { name: '生产环境' }).closest('tr')
    await user.click(within(prodRow!).getByRole('button', { name: '设为默认' }))
    await waitFor(() => expect(state.setDefaultFolder).toHaveBeenCalledWith('prod'))
    expect(await screen.findByRole('alert')).toHaveTextContent('设置默认分组失败: default failed')
    expect(toast).not.toHaveBeenCalled()
  })

  it('shows move failures as asset-center banner without toast', async () => {
    const user = userEvent.setup()
    state.moveSession.mockRejectedValueOnce(new Error('move failed'))
    render(<SessionAssetCenter />)
    await user.click(screen.getByRole('button', { name: '默认分组' }))
    await waitFor(() => expect(state.moveSession).toHaveBeenCalledWith('one', 'default'))
    expect(await screen.findByRole('alert')).toHaveTextContent('移动会话失败: move failed')
    expect(toast).not.toHaveBeenCalled()
  })

  it('serializes moves for the same session and disables alternate targets while pending', async () => {
    let resolveMove: (() => void) | undefined
    state.folders = [...folders, { id: 'archive', name: '归档分组', parentId: null, isDefault: false }]
    state.moveSession.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveMove = resolve }))
    const user = userEvent.setup()
    render(<SessionAssetCenter />)

    await user.click(screen.getByRole('button', { name: '默认分组' }))
    await waitFor(() => expect(state.moveSession).toHaveBeenCalledWith('one', 'default'))
    const archiveTarget = screen.getByRole('button', { name: '归档分组' })
    expect(archiveTarget).toBeDisabled()

    await user.click(archiveTarget)
    expect(state.moveSession).toHaveBeenCalledTimes(1)

    await act(async () => { resolveMove?.() })
    await waitFor(() => expect(archiveTarget).toBeEnabled())
    await user.click(archiveTarget)
    expect(state.moveSession).toHaveBeenLastCalledWith('one', 'archive')
  })

  it('keeps the latest asset action as the owner of the error banner', async () => {
    let rejectDefault: ((reason?: unknown) => void) | undefined
    let resolveMove: (() => void) | undefined
    state.setDefaultFolder.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectDefault = reject }))
    state.moveSession.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveMove = resolve }))
    const user = userEvent.setup()
    render(<SessionAssetCenter />)

    await user.click(screen.getByRole('tab', { name: /分组/ }))
    await user.click(within(screen.getByRole('button', { name: '生产环境' }).closest('tr')!).getByRole('button', { name: '设为默认' }))
    await user.click(screen.getByRole('tab', { name: /最近连接/ }))
    const row = screen.getByText('生产服务器').closest('tr')!
    await user.click(within(row).getByRole('button', { name: /更多操作/ }))
    await user.click(await screen.findByRole('button', { name: '默认分组' }))
    await waitFor(() => expect(state.moveSession).toHaveBeenCalledWith('one', 'default'))

    await act(async () => { resolveMove?.() })
    await act(async () => { rejectDefault?.(new Error('stale default failed')) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('locks the delete target until the active destructive operation completes', async () => {
    const resolvers: Array<() => void> = []
    state.deleteSession.mockImplementation(() => new Promise<void>((resolve) => { resolvers.push(resolve) }))
    const user = userEvent.setup()
    render(<SessionAssetCenter />)
    await user.click(screen.getByRole('tab', { name: /所有节点/ }))

    const firstRow = screen.getByText('生产服务器').closest('tr')!
    await user.click(within(firstRow).getByRole('button', { name: /更多操作/ }))
    await user.click(within(firstRow).getByRole('button', { name: '删除' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    const secondRow = screen.getByText('测试服务器').closest('tr')!
    await user.click(within(secondRow).getByRole('button', { name: /更多操作/ }))
    await user.click(within(secondRow).getByRole('button', { name: '删除' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('删除“生产服务器”？')
    expect(state.deleteSession).toHaveBeenCalledTimes(1)

    await act(async () => { resolvers[0]?.() })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(within(secondRow).getByRole('button', { name: /更多操作/ }))
    await user.click(within(secondRow).getByRole('button', { name: '删除' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('删除“测试服务器”？')
  })

  it('keeps the catalog mutation lease across asset tab navigation', async () => {
    let resolveReorder: (() => void) | undefined
    state.environments = [
      { id: 'prod', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 },
      { id: 'test', name: '测试', colorToken: 'amber', sortOrder: 1, sessionCount: 1 },
    ]
    state.reorderEnvironments.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveReorder = resolve }))
    const user = userEvent.setup()
    render(<SessionAssetCenter />)

    await user.click(screen.getByRole('tab', { name: /分类管理/ }))
    await user.click(screen.getByRole('button', { name: '下移 生产' }))
    await user.click(screen.getByRole('tab', { name: /最近连接/ }))
    await user.click(screen.getByRole('tab', { name: /分类管理/ }))

    const moveButton = screen.getByRole('button', { name: '下移 生产' })
    expect(moveButton).toBeDisabled()
    await user.click(moveButton)
    expect(state.reorderEnvironments).toHaveBeenCalledOnce()

    await act(async () => { resolveReorder?.() })
    await waitFor(() => expect(moveButton).toBeEnabled())
  })
})

function session(id: string, name: string, folderId: string) {
  return { id, name, host: `${id}.internal`, port: 22, username: id, authMethod: 'password' as const, keepAlive: 30, termType: 'xterm', folderId, connectionCount: 0 }
}
