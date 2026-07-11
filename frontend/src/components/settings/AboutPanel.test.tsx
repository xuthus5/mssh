import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const { info, checkUpdate, openURL } = vi.hoisted(() => ({
  info: vi.fn(async () => ({ current_version: '0.1.0', repository_url: 'https://github.com/xuthus5/mssh' })),
  checkUpdate: vi.fn(async () => ({ current_version: '0.1.0', latest_version: 'v0.2.0', release_url: 'https://example.com/release', update_available: true })),
  openURL: vi.fn(async () => {}),
}))

vi.mock('@/lib/wails', () => ({ AboutService: { Info: info, CheckUpdate: checkUpdate } }))
vi.mock('@wailsio/runtime', () => ({ Browser: { OpenURL: openURL } }))

import { AboutPanel } from '@/components/settings/AboutPanel'

describe('AboutPanel', () => {
  it('shows versions and opens the community repository', async () => {
    render(<AboutPanel />)
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '检查更新' }))
    expect(await screen.findByText('v0.2.0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'GitHub 社区' }))
    expect(openURL).toHaveBeenCalledWith('https://github.com/xuthus5/mssh')
  })
})
