import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { minimise, toggleMaximise, close } = vi.hoisted(() => ({
  minimise: vi.fn(async () => {}),
  toggleMaximise: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}))

vi.mock('@wailsio/runtime', () => ({
  Window: { Minimise: minimise, ToggleMaximise: toggleMaximise, Close: close },
}))

import { WindowTitleBar } from '@/components/layout/WindowTitleBar'

describe('WindowTitleBar', () => {
  beforeEach(() => vi.clearAllMocks())

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
})
