import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionQuickSearchDialog } from '@/components/session/SessionQuickSearchDialog'
import type { Folder, Session } from '@/hooks/useSession'

const folders: Folder[] = [
  { id: 'folder-ops', name: 'Operations', parentId: null, isDefault: true },
  { id: 'folder-dev', name: 'Development', parentId: null, isDefault: false },
]

const sessions: Session[] = [
  {
    id: 'session-prod', name: 'Production API', host: '10.0.0.10', port: 22,
    username: 'deploy', authMethod: 'key', keepAlive: 30, termType: 'xterm-256color', folderId: 'folder-ops',
  },
  {
    id: 'session-dev', name: 'Development', host: '10.0.0.20', port: 2222,
    username: 'developer', authMethod: 'password', keepAlive: 30, termType: 'xterm-256color', folderId: 'folder-dev',
  },
  {
    id: 'session-lab', name: 'Lab Router', host: 'router.local', port: 22,
    username: 'root', authMethod: 'agent', keepAlive: 30, termType: 'xterm-256color', folderId: null,
  },
]

function renderDialog(customSessions = sessions) {
  const onOpenChange = vi.fn()
  const onConnect = vi.fn()
  render(<SessionQuickSearchDialog open onOpenChange={onOpenChange} sessions={customSessions}
    folders={folders} onConnect={onConnect} />)
  return { onOpenChange, onConnect }
}

describe('SessionQuickSearchDialog', () => {
  it.each([
    ['production', 'Production API'],
    ['10.0.0.20', 'Development'],
    ['ROOT', 'Lab Router'],
    ['operations', 'Production API'],
  ])('filters sessions with query %s', async (query, expectedName) => {
    renderDialog()
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索会话' }), query)
    expect(screen.getByRole('option', { name: new RegExp(expectedName) })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('shows connection and folder details', () => {
    renderDialog()
    expect(screen.getByText('deploy@10.0.0.10:22')).toBeInTheDocument()
    expect(screen.getByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('未分组')).toBeInTheDocument()
  })

  it('cycles selection and connects with Enter', () => {
    const { onOpenChange, onConnect } = renderDialog()
    const searchbox = screen.getByRole('searchbox', { name: '搜索会话' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(searchbox, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(searchbox, { key: 'Enter' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConnect).toHaveBeenCalledWith('session-dev')
  })

  it('wraps upward from the first result', () => {
    renderDialog()
    fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜索会话' }), { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')
  })

  it('resets selection when the query changes', async () => {
    renderDialog()
    const searchbox = screen.getByRole('searchbox', { name: '搜索会话' })
    fireEvent.keyDown(searchbox, { key: 'ArrowDown' })
    await userEvent.type(searchbox, 'router')
    const option = screen.getByRole('option', { name: /Lab Router/ })
    expect(option).toHaveAttribute('aria-selected', 'true')
  })

  it('connects the double-clicked session', async () => {
    const { onOpenChange, onConnect } = renderDialog()
    await userEvent.dblClick(screen.getByRole('option', { name: /Lab Router/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConnect).toHaveBeenCalledWith('session-lab')
  })

  it('shows distinct empty states', async () => {
    const view = renderDialog([])
    expect(screen.getByText('暂无会话')).toBeInTheDocument()
    view.onConnect.mockClear()
    fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜索会话' }), { key: 'Enter' })
    expect(view.onConnect).not.toHaveBeenCalled()
  })

  it('shows no-match guidance', async () => {
    renderDialog()
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索会话' }), 'missing-session')
    expect(screen.getByText('未找到匹配会话')).toBeInTheDocument()
  })
})
