import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Folder, Session } from '@/hooks/useSession'

const workspace = vi.hoisted(() => ({
  connect: vi.fn(),
  folders: [{ id: 'folder-1', name: 'Production', parentId: null, isDefault: true }] as Folder[],
  sessions: [{
    id: 'session-1', name: 'Production API', host: 'prod.internal', port: 22,
    username: 'deploy', authMethod: 'key', keepAlive: 30, termType: 'xterm-256color', folderId: 'folder-1',
  }] as Session[],
}))

vi.mock('@/hooks/SessionWorkspaceContext', () => ({
  useSessionWorkspace: () => workspace,
}))

import { SessionQuickSearchHost } from '@/components/session/SessionQuickSearchHost'

afterEach(() => {
  workspace.connect.mockClear()
})

describe('SessionQuickSearchHost', () => {
  it('opens from the global event and connects through the workspace', () => {
    render(<SessionQuickSearchHost />)
    act(() => window.dispatchEvent(new CustomEvent('mssh:open-session-search')))
    expect(screen.getByRole('dialog', { name: '快速连接会话' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜索会话' }), { key: 'Enter' })
    expect(workspace.connect).toHaveBeenCalledWith('session-1')
    expect(screen.queryByRole('dialog', { name: '快速连接会话' })).not.toBeInTheDocument()
  })

  it('can reopen after being closed', () => {
    render(<SessionQuickSearchHost />)
    act(() => window.dispatchEvent(new CustomEvent('mssh:open-session-search')))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    act(() => window.dispatchEvent(new CustomEvent('mssh:open-session-search')))
    expect(screen.getByRole('dialog', { name: '快速连接会话' })).toBeInTheDocument()
  })

  it('refocuses search when the shortcut event repeats', () => {
    render(<SessionQuickSearchHost />)
    act(() => window.dispatchEvent(new CustomEvent('mssh:open-session-search')))
    const searchbox = screen.getByRole('searchbox', { name: '搜索会话' })
    const closeButton = screen.getByRole('button', { name: 'Close' })
    closeButton.focus()
    expect(closeButton).toHaveFocus()
    act(() => window.dispatchEvent(new CustomEvent('mssh:open-session-search')))
    expect(searchbox).toHaveFocus()
  })
})
