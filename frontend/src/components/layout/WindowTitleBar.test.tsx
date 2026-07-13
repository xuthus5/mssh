import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { minimise, toggleMaximise, close, getSetting, setSetting } = vi.hoisted(() => ({
  minimise: vi.fn(async () => {}),
  toggleMaximise: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  getSetting: vi.fn(async () => ''),
  setSetting: vi.fn(async (_setting: unknown) => {}),
}))

vi.mock('@wailsio/runtime', () => ({
  Window: { Minimise: minimise, ToggleMaximise: toggleMaximise, Close: close },
}))

vi.mock('@/lib/wails', () => ({
  SettingService: { Get: getSetting, Set: setSetting },
  ThemeService: {
    InitializeDefaults: vi.fn(async () => {}),
    ListDefinitions: vi.fn(async () => []),
    ListProfiles: vi.fn(async () => []),
    GetAssignments: vi.fn(async () => ({ dark_profile_id: 0, light_profile_id: 0 })),
  },
}))

import { WindowTitleBar } from '@/components/layout/WindowTitleBar'
import { useAppStore } from '@/store/appStore'

describe('WindowTitleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSetting.mockResolvedValue('')
    setSetting.mockResolvedValue(undefined)
    localStorage.clear()
    document.documentElement.classList.remove('light')
    useAppStore.setState({
      activeSurface: null,
      navigationCollapsed: false,
      workspaceTab: 'sessions',
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
    const sessionsTab = screen.getByRole('tab', { name: '会话' })
    const macrosTab = screen.getByRole('tab', { name: '宏' })
    expect(sessionsTab).toHaveAttribute('aria-selected', 'false')
    expect(sessionsTab.querySelector('svg')).toBeInTheDocument()
    expect(macrosTab.querySelector('svg')).toBeInTheDocument()

    await userEvent.click(macrosTab)

    expect(useAppStore.getState().workspaceTab).toBe('macros')
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'workspace', id: 'macros' })
    expect(macrosTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('Secure Shell Client')).not.toBeInTheDocument()
  })

  it('collapses fixed navigation and the sidebar together', async () => {
    useAppStore.setState({ activeSurface: { type: 'workspace', id: 'sessions' } })
    render(<WindowTitleBar />)

    const navigationButton = screen.getByRole('button', { name: '收起导航' })
    expect(navigationButton).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(navigationButton)

    expect(useAppStore.getState().navigationCollapsed).toBe(true)
    expect(screen.queryByRole('tab', { name: '会话' })).not.toBeInTheDocument()
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
  })
})
