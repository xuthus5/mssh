import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { minimise, toggleMaximise, close, getSetting, setSetting } = vi.hoisted(() => ({
  minimise: vi.fn(async () => {}),
  toggleMaximise: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  getSetting: vi.fn(async () => ''),
  setSetting: vi.fn(async (_setting: unknown) => {}),
}))

let triggerTabResize = () => {}

vi.mock('@wailsio/runtime', () => ({
  Window: { Minimise: minimise, ToggleMaximise: toggleMaximise, Close: close },
}))

vi.mock('@/lib/wails', () => ({
  SettingService: { Get: getSetting, Set: setSetting },
  ThemeService: {
    InitializeDefaults: vi.fn(async () => {}),
    ListDefinitions: vi.fn(async () => themeProfiles.map((profile) => profile.definition)),
    ListProfiles: vi.fn(async () => themeProfiles),
    GetAssignments: vi.fn(async () => ({ dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 })),
    GetGlobalStyle: vi.fn(async () => ({ font_family: 'monospace', font_size: 14, cursor_style: 'bar' })),
  },
}))

vi.mock('@/hooks/SessionWorkspaceContext', () => ({
  useSessionWorkspace: () => ({ connect: vi.fn(async () => {}) }),
}))

import { WindowTitleBar } from '@/components/layout/WindowTitleBar'
import { useAppStore } from '@/store/appStore'

const themeProfiles = [themeProfile(1, 'dark', '#000000'), themeProfile(2, 'light', '#ffffff')]

describe('WindowTitleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSetting.mockResolvedValue('')
    setSetting.mockResolvedValue(undefined)
    localStorage.clear()
    document.documentElement.classList.remove('light')
    triggerTabResize = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        triggerTabResize = () => callback([], this as unknown as ResizeObserver)
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    })
    useAppStore.setState({
      tabs: [],
      activeSurface: null,
      navigationCollapsed: false,
      workspaceTab: 'sessions',
      connectionStatus: {},
    })
  })

  it('routes window controls to the Wails runtime', async () => {
    const user = userEvent.setup()
    render(<WindowTitleBar />)
    await user.click(screen.getByRole('button', { name: '最小化窗口' }))
    await user.click(screen.getByRole('button', { name: '最大化或还原窗口' }))
    await user.click(screen.getByRole('button', { name: '关闭窗口' }))
    expect(minimise).toHaveBeenCalledOnce()
    expect(toggleMaximise).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('toggles maximise when the drag region is double-clicked', async () => {
    render(<WindowTitleBar />)
    await userEvent.dblClick(screen.getByTestId('window-drag-region'))
    expect(toggleMaximise).toHaveBeenCalledOnce()
  })

  it('toggles and persists the application colour mode', async () => {
    render(<WindowTitleBar />)
    await userEvent.click(screen.getByRole('button', { name: '切换到浅色模式' }))
    expect(document.documentElement).toHaveClass('light')
    expect(localStorage.getItem('mssh:color-mode')).toBe('light')
    expect(setSetting).toHaveBeenCalledWith(expect.objectContaining({ key: 'appearance.color_mode', value: '"light"' }))
    expect(setSetting.mock.calls[0][0]).not.toHaveProperty('updated_at')
    expect(screen.getByRole('button', { name: '切换到深色模式' })).toBeInTheDocument()
  })

  it('requests the settings dialog from the title bar', async () => {
    const listener = vi.fn()
    window.addEventListener('mssh:open-settings', listener)
    render(<WindowTitleBar />)
    await userEvent.click(screen.getByRole('button', { name: '打开设置' }))
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener('mssh:open-settings', listener)
  })

  it('switches the sidebar navigation from the window title bar', async () => {
    render(<WindowTitleBar />)
    const sessionsButton = screen.getByRole('button', { name: '会话' })
    const macrosButton = screen.getByRole('button', { name: '宏' })
    expect(sessionsButton).toHaveAttribute('aria-pressed', 'false')
    expect(sessionsButton.querySelector('svg')).toBeInTheDocument()
    expect(macrosButton.querySelector('svg')).toBeInTheDocument()

    await userEvent.click(macrosButton)

    expect(useAppStore.getState().workspaceTab).toBe('macros')
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'workspace', id: 'macros' })
    expect(macrosButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Secure Shell Client')).not.toBeInTheDocument()
  })

  it('opens the macro sidebar without covering an active terminal', async () => {
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: '生产服务器', type: 'terminal', terminalId: 'term-1' }],
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      workspaceTab: 'sessions',
      connectionStatus: { 'term-1': 'connected' },
    })
    render(<WindowTitleBar />)

    await userEvent.click(screen.getByRole('button', { name: '宏' }))

    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      workspaceTab: 'macros',
    })
    expect(screen.getByRole('button', { name: '宏' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '宏' })).toHaveAttribute('aria-controls', 'sidebar-navigation')
    expect(screen.getByRole('tab', { name: /生产服务器/ })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('button', { name: '会话' }))
    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'workspace', id: 'sessions' },
      workspaceTab: 'sessions',
    })
  })

  it('links fixed navigation buttons to the sidebar', () => {
    render(<WindowTitleBar />)

    expect(screen.getByRole('button', { name: '会话' })).toHaveAttribute('id', 'workspace-tab-sessions')
    expect(screen.getByRole('button', { name: '会话' })).toHaveAttribute('aria-controls', 'sidebar-navigation')
    expect(screen.getByRole('button', { name: '宏' })).toHaveAttribute('id', 'workspace-tab-macros')
    expect(screen.getByRole('button', { name: '宏' })).toHaveAttribute('aria-controls', 'sidebar-navigation')
  })

  it('collapses fixed navigation and the sidebar together', async () => {
    useAppStore.setState({ activeSurface: { type: 'workspace', id: 'sessions' } })
    render(<WindowTitleBar />)

    const navigationButton = screen.getByRole('button', { name: '收起导航' })
    expect(navigationButton).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(navigationButton)

    expect(useAppStore.getState().navigationCollapsed).toBe(true)
    expect(screen.queryByRole('button', { name: '会话' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开导航' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('places dynamic tabs before the window drag region', () => {
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: '生产服务器', type: 'terminal', terminalId: 'term-1' }],
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      connectionStatus: { 'term-1': 'connected' },
    })
    render(<WindowTitleBar />)

    const tab = screen.getByRole('tab', { name: /生产服务器/ })
    const dragRegion = screen.getByTestId('window-drag-region')
    expect(tab.compareDocumentPosition(dragRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dragRegion).toHaveClass('min-w-20', 'flex-1')
  })

  it('shows the overflow menu before the theme toggle only when tabs overflow', () => {
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: '生产服务器', type: 'terminal', terminalId: 'term-1' }],
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      connectionStatus: { 'term-1': 'connected' },
    })
    render(<WindowTitleBar />)
    const tabList = screen.getByRole('tablist', { name: '动态标签' })
    let clientWidth = 240
    let scrollWidth = 240
    Object.defineProperty(tabList, 'clientWidth', { configurable: true, get: () => clientWidth })
    Object.defineProperty(tabList, 'scrollWidth', { configurable: true, get: () => scrollWidth })

    act(() => triggerTabResize())
    expect(screen.queryByRole('button', { name: '打开标签列表' })).not.toBeInTheDocument()

    clientWidth = 120
    scrollWidth = 260
    act(() => triggerTabResize())
    const menuButton = screen.getByRole('button', { name: '打开标签列表' })
    const dragRegion = screen.getByTestId('window-drag-region')
    const themeButton = screen.getByRole('button', { name: /切换到(浅色|深色)模式/ })
    expect(dragRegion.compareDocumentPosition(menuButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(menuButton.compareDocumentPosition(themeButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    scrollWidth = 120
    act(() => triggerTabResize())
    expect(screen.queryByRole('button', { name: '打开标签列表' })).not.toBeInTheDocument()
  })
})

function themeProfile(id: number, mode: 'dark' | 'light', background: string) {
  return {
    id,
    name: mode,
    theme_id: id,
    follow_global_style: true,
    font_family: 'monospace',
    font_size: 14,
    cursor_style: 'bar',
    color_overrides: '{}',
    definition: {
      id,
      name: mode,
      mode,
      color_payload: JSON.stringify({ background, foreground: mode === 'dark' ? '#ffffff' : '#000000', cursor: '#888888', selection: '#264f78', ansi: Array(16).fill('#111111') }),
    },
  }
}
