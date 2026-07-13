import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  folders: [] as any[],
  sessions: [] as any[],
  recentSessions: [] as any[],
  loading: false,
  error: '',
  listFolders: vi.fn(),
  listSessions: vi.fn(),
  listRecentSessions: vi.fn(),
  connect: vi.fn(),
  deleteFolder: vi.fn(),
  deleteSession: vi.fn(),
  setDefaultFolder: vi.fn(),
  moveSession: vi.fn(),
}))
const toast = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => state }))
vi.mock('@/components/ui/toast', () => ({ toast }))
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
    Object.assign(state, { folders: [...folders], sessions: [...sessions], recentSessions: [{ ...sessions[0], lastConnectedAt: '2026-07-12T12:00:00Z', connectionCount: 3 }], loading: false, error: '' })
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

  it('reports action failures through toast', async () => {
    const user = userEvent.setup()
    state.setDefaultFolder.mockRejectedValueOnce(new Error('default failed'))
    render(<SessionAssetCenter />)
    await user.click(screen.getByRole('tab', { name: /分组/ }))
    const prodRow = screen.getByRole('button', { name: '生产环境' }).closest('tr')
    await user.click(within(prodRow!).getByRole('button', { name: '设为默认' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('default failed', 'error'))
  })
})

function session(id: string, name: string, folderId: string) {
  return { id, name, host: `${id}.internal`, port: 22, username: id, authMethod: 'password' as const, keepAlive: 30, termType: 'xterm', folderId, connectionCount: 0 }
}
