import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = vi.hoisted(() => ({
  folders: [],
  sessions: [],
  createFolder: vi.fn(async () => {}),
  updateFolder: vi.fn(async () => {}),
  createSession: vi.fn(async () => {}),
  updateSession: vi.fn(async () => {}),
  connect: vi.fn(async () => {}),
  loading: false,
  error: null,
  listFolders: vi.fn(async () => {}),
  listSessions: vi.fn(async () => {}),
}))

vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => workspace }))
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({}) }))
vi.mock('@/hooks/useThemeCatalog', () => ({ useThemeCatalog: () => ({}) }))
vi.mock('@/components/session/SessionTree', () => ({ default: () => null }))
vi.mock('@/components/session/QuickCommands', () => ({ default: () => null }))
vi.mock('@/components/layout/SidebarDialogs', () => ({ SidebarDialogs: () => null }))
vi.mock('@/lib/wails', () => ({
  MacroService: {
    List: vi.fn(async () => []),
    Execute: vi.fn(async () => {}),
    Create: vi.fn(async () => ({})),
    Delete: vi.fn(async () => {}),
  },
}))

import Sidebar from '@/components/layout/Sidebar'
import { useAppStore } from '@/store/appStore'

describe('Sidebar navigation collapse', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState({ navigationCollapsed: false, workspaceTab: 'sessions', sidebarWidth: 280 })
  })

  it('collapses and restores the persistent sidebar width through shared navigation state', () => {
    useAppStore.getState().setSidebarWidth(360)
    const { container } = render(<Sidebar />)
    const sidebar = container.querySelector('#sidebar-navigation')
    if (!sidebar || !sidebar.parentElement) throw new Error('sidebar navigation was not rendered')
    const sidebarContainer = sidebar.parentElement

    expect(sidebar).toBeInTheDocument()
    expect(sidebarContainer).toHaveStyle({ width: '360px' })
    expect(localStorage.getItem('mssh:sidebar-width')).toBe('360')
    expect(screen.getByRole('separator', { name: '调整侧边栏宽度' })).toHaveAttribute('tabindex', '0')
    expect(screen.queryByRole('button', { name: /^(收起|展开)侧边栏$/ })).not.toBeInTheDocument()

    act(() => useAppStore.getState().toggleNavigation())

    expect(sidebarContainer).toHaveStyle({ width: '0px' })
    expect(sidebar).toHaveAttribute('aria-hidden', 'true')
    expect(sidebar).toHaveAttribute('inert')
    expect(screen.queryByRole('separator', { name: '调整侧边栏宽度' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(收起|展开)侧边栏$/ })).not.toBeInTheDocument()

    act(() => useAppStore.getState().toggleNavigation())

    expect(sidebarContainer).toHaveStyle({ width: '360px' })
    expect(sidebar).toHaveAttribute('aria-hidden', 'false')
    expect(sidebar).not.toHaveAttribute('inert')
    expect(screen.getByRole('separator', { name: '调整侧边栏宽度' })).toHaveAttribute('tabindex', '0')
  })
})
