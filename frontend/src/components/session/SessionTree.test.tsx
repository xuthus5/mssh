import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionTree from '@/components/session/SessionTree'

const FOLDERS = [
  { id: 'f1', name: '生产环境', parentId: null, isDefault: true },
  { id: 'f2', name: '测试环境', parentId: null, isDefault: false },
]

const SESSIONS = [
  { id: 's1', name: 'web-01', host: '10.0.0.1', port: 22, username: 'root',
    authMethod: 'password' as const, keepAlive: 30, termType: 'xterm', folderId: null },
  { id: 's2', name: 'db-master', host: '10.0.0.2', port: 3306, username: 'dba',
    authMethod: 'key' as const, keepAlive: 60, termType: 'xterm-256color', folderId: 'f1' },
  { id: 's3', name: 'test-web', host: '10.0.1.1', port: 22, username: 'admin',
    authMethod: 'password' as const, keepAlive: 30, termType: 'xterm', folderId: 'f2' },
]

describe('SessionTree', () => {
  it('renders folders and sessions', () => {
    render(<SessionTree
      folders={FOLDERS}
      sessions={SESSIONS}
      onConnect={vi.fn()}
      onEditSession={vi.fn()}
      onDeleteSession={vi.fn()}
      onEditFolder={vi.fn()}
      onDeleteFolder={vi.fn()}
    />)

    expect(screen.getByText('生产环境')).toBeInTheDocument()
    expect(screen.getByText('测试环境')).toBeInTheDocument()
    // Top-level session (folderId: null)
    expect(screen.getByText('web-01')).toBeInTheDocument()
  })

  it('shows sessions inside expanded folder', async () => {
    const user = userEvent.setup()
    render(<SessionTree
      folders={FOLDERS}
      sessions={SESSIONS}
      onConnect={vi.fn()}
      onEditSession={vi.fn()}
      onDeleteSession={vi.fn()}
      onEditFolder={vi.fn()}
      onDeleteFolder={vi.fn()}
    />)

    // db-master is inside "生产环境" (folder f1) — hidden initially
    expect(screen.queryByText('db-master')).not.toBeInTheDocument()

    // Click on "生产环境" to expand
    await user.click(screen.getByText('生产环境'))

    // Now db-master should be visible
    expect(screen.getByText('db-master')).toBeInTheDocument()
  })

  it('reports folder expansion to the controlled handler', async () => {
    const user = userEvent.setup()
    const onExpandedFolderIDsChange = vi.fn()
    const view = render(<SessionTree
      folders={FOLDERS}
      sessions={SESSIONS}
      expandedFolderIDs={[]}
      onExpandedFolderIDsChange={onExpandedFolderIDsChange}
      onConnect={vi.fn()}
      onEditSession={vi.fn()}
      onDeleteSession={vi.fn()}
      onEditFolder={vi.fn()}
      onDeleteFolder={vi.fn()}
    />)

    await user.click(screen.getByText('生产环境'))
    expect(onExpandedFolderIDsChange).toHaveBeenCalledWith(['f1'])

    view.rerender(<SessionTree
      folders={FOLDERS}
      sessions={SESSIONS}
      expandedFolderIDs={['f1']}
      onExpandedFolderIDsChange={onExpandedFolderIDsChange}
      onConnect={vi.fn()}
      onEditSession={vi.fn()}
      onDeleteSession={vi.fn()}
      onEditFolder={vi.fn()}
      onDeleteFolder={vi.fn()}
    />)
    await user.click(screen.getByText('生产环境'))
    expect(onExpandedFolderIDsChange).toHaveBeenCalledWith([])
  })

  it('renders sessions inside folders expanded via controlled state', () => {
    render(<SessionTree
      folders={FOLDERS}
      sessions={SESSIONS}
      expandedFolderIDs={['f1']}
      onExpandedFolderIDsChange={vi.fn()}
      onConnect={vi.fn()}
      navigationOnly
    />)

    expect(screen.getByText('db-master')).toBeInTheDocument()
    expect(screen.queryByText('test-web')).not.toBeInTheDocument()
  })

  it('connects once without allowing browser text selection on double click', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    render(<SessionTree
      folders={[]}
      sessions={SESSIONS}
      onConnect={onConnect}
      onEditSession={vi.fn()}
      onDeleteSession={vi.fn()}
      onEditFolder={vi.fn()}
      onDeleteFolder={vi.fn()}
    />)

    const sessionItem = screen.getByRole('treeitem', { name: 'web-01' })
    expect(sessionItem).toHaveClass('select-none')
    await user.dblClick(sessionItem)

    expect(onConnect).toHaveBeenCalledWith('s1')
    expect(onConnect).toHaveBeenCalledTimes(1)
    onConnect.mockClear()
    expect(fireEvent.doubleClick(sessionItem)).toBe(false)
    expect(onConnect).toHaveBeenCalledTimes(1)

    await user.pointer({ target: sessionItem, keys: '[MouseRight]' })
    expect(await screen.findByRole('menuitem', { name: '连接' })).toBeInTheDocument()
  })

  it('runs duplicate, quick rename, and copy-credentials context actions', async () => {
    const user = userEvent.setup()
    const onDuplicateSession = vi.fn()
    const onQuickRenameSession = vi.fn()
    const onCopyCredentials = vi.fn()
    render(<SessionTree
      folders={[]}
      sessions={[SESSIONS[0]]}
      onConnect={vi.fn()}
      onEditSession={vi.fn()}
      onDuplicateSession={onDuplicateSession}
      onQuickRenameSession={onQuickRenameSession}
      onCopyCredentials={onCopyCredentials}
      onDeleteSession={vi.fn()}
    />)

    await user.pointer({ target: screen.getByRole('treeitem', { name: 'web-01' }), keys: '[MouseRight]' })
    await user.click(await screen.findByRole('menuitem', { name: '复制会话' }))
    expect(onDuplicateSession).toHaveBeenCalledWith(SESSIONS[0])

    await user.pointer({ target: screen.getByRole('treeitem', { name: 'web-01' }), keys: '[MouseRight]' })
    await user.click(await screen.findByRole('menuitem', { name: '快速重命名' }))
    expect(onQuickRenameSession).toHaveBeenCalledWith(SESSIONS[0])

    await user.pointer({ target: screen.getByRole('treeitem', { name: 'web-01' }), keys: '[MouseRight]' })
    await user.click(await screen.findByRole('menuitem', { name: '复制账号密码' }))
    expect(onCopyCredentials).toHaveBeenCalledWith(SESSIONS[0])
  })

  it('shows session connection details on hover', async () => {
    const user = userEvent.setup()
    render(<SessionTree folders={[]} sessions={[SESSIONS[0]]} onConnect={vi.fn()} navigationOnly />)

    await user.hover(screen.getByRole('treeitem', { name: 'web-01' }))

    expect(await screen.findByText('主机：10.0.0.1')).toBeInTheDocument()
    expect(screen.getByText('端口：22')).toBeInTheDocument()
    expect(screen.getByText('用户：root')).toBeInTheDocument()
  })

  it('prevents browser text selection when a folder is double clicked', () => {
    render(<SessionTree
      folders={FOLDERS}
      sessions={SESSIONS}
      onConnect={vi.fn()}
      onSelectFolder={vi.fn()}
      navigationOnly
    />)

    const folderItem = screen.getByRole('treeitem', { name: /生产环境/ })
    expect(folderItem).toHaveClass('select-none')
    expect(fireEvent.doubleClick(folderItem)).toBe(false)
  })

  it('shows empty message when no data', () => {
    render(<SessionTree
      folders={[]}
      sessions={[]}
      onConnect={vi.fn()}
      onEditSession={vi.fn()}
      onDeleteSession={vi.fn()}
      onEditFolder={vi.fn()}
      onDeleteFolder={vi.fn()}
    />)

    expect(screen.getByText('暂无会话')).toBeInTheDocument()
  })
})
