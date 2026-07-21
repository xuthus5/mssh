import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: any) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: any) => <>{children}</>,
  ContextMenuContent: ({ children }: any) => <div>{children}</div>,
  ContextMenuItem: ({ children, onClick, disabled }: any) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
  ContextMenuSeparator: () => <hr />,
  ContextMenuSub: ({ children }: any) => <div>{children}</div>,
  ContextMenuSubTrigger: ({ children }: any) => <span>{children}</span>,
  ContextMenuSubContent: ({ children }: any) => <div>{children}</div>,
}))

import SessionTree from '@/components/session/SessionTree'

const folders = [
  { id: 'f1', name: '生产环境', parentId: null, isDefault: false },
  { id: 'f2', name: '数据库', parentId: 'f1', isDefault: false },
]
const sessions = [
  { id: 's1', name: 'web-01', host: '10.0.0.1', port: 22, username: 'root', authMethod: 'password' as const, keepAlive: 30, termType: 'xterm', folderId: null },
  { id: 's2', name: 'db-01', host: '10.0.0.2', port: 22, username: 'dba', authMethod: 'key' as const, keepAlive: 30, termType: 'xterm', folderId: 'f2' },
]

describe('SessionTree behavior', () => {
  it('supports keyboard expansion, collapse, and folder selection', () => {
    const onSelectFolder = vi.fn()
    render(<SessionTree folders={folders} sessions={sessions} onConnect={vi.fn()} onSelectFolder={onSelectFolder} navigationOnly />)
    const folder = screen.getByRole('treeitem', { name: /生产环境/ })

    fireEvent.keyDown(folder, { key: 'Enter' })
    expect(onSelectFolder).toHaveBeenCalledWith('f1')
    expect(screen.getByText('数据库')).toBeInTheDocument()
    fireEvent.keyDown(folder, { key: 'ArrowLeft' })
    expect(screen.queryByText('数据库')).not.toBeInTheDocument()
    fireEvent.keyDown(folder, { key: 'ArrowRight' })
    expect(screen.getByText('数据库')).toBeInTheDocument()
    fireEvent.keyDown(folder, { key: ' ' })
    expect(screen.queryByText('数据库')).not.toBeInTheDocument()
  })

  it('connects from keyboard in navigation mode and reveals nested sessions', () => {
    const onConnect = vi.fn()
    const { rerender } = render(<SessionTree folders={[]} sessions={[sessions[0]]} onConnect={onConnect} navigationOnly />)
    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'web-01' }), { key: 'Enter' })
    expect(onConnect).toHaveBeenCalledWith('s1')

    rerender(<SessionTree folders={folders} sessions={sessions} onConnect={onConnect} navigationOnly revealAll />)
    expect(screen.getByText('db-01')).toBeInTheDocument()
  })

  it('runs folder and session context actions', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    const onEditSession = vi.fn()
    const onDeleteSession = vi.fn()
    const onEditFolder = vi.fn()
    const onDeleteFolder = vi.fn()
    const onMoveToFolder = vi.fn()
    render(<SessionTree folders={folders} sessions={[sessions[0]]} onConnect={onConnect} onEditSession={onEditSession} onDeleteSession={onDeleteSession} onEditFolder={onEditFolder} onDeleteFolder={onDeleteFolder} onMoveToFolder={onMoveToFolder} revealAll />)

    const editButtons = screen.getAllByRole('button', { name: '编辑' })
    await user.click(editButtons[0])
    await user.click(editButtons.at(-1)!)
    expect(onEditFolder).toHaveBeenCalledWith(folders[0])
    expect(onEditSession).toHaveBeenCalledWith(sessions[0])

    await user.click(screen.getByRole('button', { name: '连接' }))
    await user.click(screen.getByRole('button', { name: '生产环境' }))
    const deleteButtons = screen.getAllByRole('button', { name: '删除' })
    await user.click(deleteButtons[0])
    await user.click(deleteButtons.at(-1)!)
    expect(onConnect).toHaveBeenCalledWith('s1')
    expect(onMoveToFolder).toHaveBeenCalledWith('s1', 'f1')
    expect(onDeleteFolder).toHaveBeenCalledWith('f1')
    expect(onDeleteSession).toHaveBeenCalledWith('s1')
  })

  it('scrolls the active treeitem into view on keyboard navigation', () => {
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      render(<SessionTree folders={[]} sessions={[sessions[0], { ...sessions[0], id: 's9', name: 'web-09' }]} onConnect={vi.fn()} navigationOnly />)
      const tree = screen.getByRole('tree')
      fireEvent.keyDown(tree, { key: 'ArrowDown' })
      expect(scrollIntoView).toHaveBeenCalled()
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

})
