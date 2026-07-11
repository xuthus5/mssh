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
    useAppStore.setState({ sidebarTab: 'sessions' })
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
    expect(sessionsTab).toHaveAttribute('aria-selected', 'true')
    expect(sessionsTab.querySelector('svg')).toBeInTheDocument()
    expect(macrosTab.querySelector('svg')).toBeInTheDocument()

    await userEvent.click(macrosTab)

    expect(useAppStore.getState().sidebarTab).toBe('macros')
    expect(screen.queryByText('Secure Shell Client')).not.toBeInTheDocument()
  })
})
