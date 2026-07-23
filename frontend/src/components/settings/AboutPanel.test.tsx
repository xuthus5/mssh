import { render, screen, waitFor } from '@testing-library/react'
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
import { useToastStore } from '@/components/ui/toast'

describe('AboutPanel', () => {
  it('shows versions and opens the community repository', async () => {
    useToastStore.setState({ toasts: [] })
    render(<AboutPanel />)
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '检查更新' }))
    expect(await screen.findByText('v0.2.0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'GitHub 社区' }))
    expect(openURL).toHaveBeenCalledWith('https://github.com/xuthus5/mssh')
  })

  it('toasts about info load failures', async () => {
    useToastStore.setState({ toasts: [] })
    info.mockRejectedValueOnce(new Error('about failed'))
    render(<AboutPanel />)
    expect(await screen.findByText('未知')).toBeInTheDocument()
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('about failed'))).toBe(true))
  })

  it('toasts check-update failures while keeping the panel message', async () => {
    useToastStore.setState({ toasts: [] })
    checkUpdate.mockRejectedValueOnce(new Error('update failed'))
    render(<AboutPanel />)
    await userEvent.click(await screen.findByRole('button', { name: '检查更新' }))
    expect(await screen.findByText('检查更新失败：update failed')).toBeInTheDocument()
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('update failed') && item.type === 'error')).toBe(true))
  })

  it('toasts external link open failures', async () => {
    useToastStore.setState({ toasts: [] })
    openURL.mockRejectedValueOnce(new Error('open blocked'))
    render(<AboutPanel />)
    await userEvent.click(await screen.findByRole('button', { name: 'GitHub 社区' }))
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('open blocked') && item.type === 'error')).toBe(true))
  })
})
