import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const close = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@wailsio/runtime', () => ({ Window: { Close: close } }))

import { SettingsWindowTitleBar } from '@/components/settings/SettingsWindowTitleBar'

describe('SettingsWindowTitleBar', () => {
  it('uses the Wails drag region and closes the native window', async () => {
    render(<SettingsWindowTitleBar />)
    const titlebar = screen.getByRole('banner')
    expect(titlebar).toHaveClass('[--wails-draggable:drag]', 'border-b', 'bg-card')
    const closeButton = screen.getByRole('button', { name: '关闭设置' })
    expect(closeButton).toHaveClass('[--wails-draggable:no-drag]')
    await userEvent.click(closeButton)
    expect(close).toHaveBeenCalledOnce()
  })
})
