import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { info, checkUpdate, downloadUpdate, restartUpdate, readyUpdate, requestAutoUpdateCheck, setSetting, getMany, openURL, requestConfirm } = vi.hoisted(() => ({
  info: vi.fn(async () => ({ current_version: '0.1.0', repository_url: 'https://github.com/xuthus5/mssh' })),
  checkUpdate: vi.fn(async () => ({ current_version: '0.1.0', latest_version: 'v0.2.0', release_url: 'https://github.com/xuthus5/mssh/releases/tag/v0.2.0', update_available: true })),
  downloadUpdate: vi.fn(async () => ({ current_version: '0.1.0', latest_version: 'v0.2.0', release_url: 'https://github.com/xuthus5/mssh/releases/tag/v0.2.0', update_available: true })),
  restartUpdate: vi.fn(async () => {}),
  readyUpdate: vi.fn(async (): Promise<{ current_version: string; latest_version: string; release_url: string; update_available: boolean } | null> => null),
  requestAutoUpdateCheck: vi.fn(async () => {}),
  setSetting: vi.fn(async () => {}),
  getMany: vi.fn(async () => ({})),
  openURL: vi.fn(async () => {}),
  requestConfirm: vi.fn(async () => true),
}))

vi.mock('@/lib/wails', () => ({
  AboutService: { Info: info, CheckUpdate: checkUpdate, DownloadUpdate: downloadUpdate, RestartUpdate: restartUpdate, ReadyUpdate: readyUpdate, RequestAutoUpdateCheck: requestAutoUpdateCheck },
  SettingService: { GetMany: getMany, Set: setSetting },
}))
vi.mock('@wailsio/runtime', () => ({ Browser: { OpenURL: openURL } }))
vi.mock('@/lib/confirmDialog', () => ({ requestConfirm }))

import { AboutPanel } from '@/components/settings/AboutPanel'
import { useToastStore } from '@/components/ui/toast'
import { useLanguageStore } from '@/i18n'

describe('AboutPanel', () => {
  afterEach(() => {
    useLanguageStore.getState().setLanguage('zh-CN')
    vi.clearAllMocks()
  })

  it('shows versions, downloads an update, and restarts after confirmation', async () => {
    useToastStore.setState({ toasts: [] })
    render(<AboutPanel />)
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '检查更新' }))
    expect(await screen.findByText('v0.2.0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '下载更新' }))
    expect(downloadUpdate).toHaveBeenCalledTimes(1)
    await userEvent.click(await screen.findByRole('button', { name: '立即重启更新' }))
    expect(requestConfirm).toHaveBeenCalledTimes(1)
    expect(restartUpdate).toHaveBeenCalledTimes(1)
  })

  it('saves the automatic update setting and asks the backend to check now', async () => {
    render(<AboutPanel />)
    const toggle = await screen.findByRole('switch', { name: '自动检查并下载更新' })
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    expect(setSetting).toHaveBeenCalledWith(expect.objectContaining({ key: 'application.auto_update', value: 'true', value_type: 'boolean' }))
    expect(requestAutoUpdateCheck).toHaveBeenCalledTimes(1)
  })

  it('loads a previously downloaded update and exposes restart', async () => {
    readyUpdate.mockResolvedValueOnce({ current_version: '0.1.0', latest_version: 'v0.3.0', release_url: 'https://github.com/xuthus5/mssh/releases/tag/v0.3.0', update_available: true })
    render(<AboutPanel />)
    expect(await screen.findByRole('button', { name: '立即重启更新' })).toBeInTheDocument()
  })

  it('shows about info load failures inline without toast', async () => {
    useToastStore.setState({ toasts: [] })
    info.mockRejectedValueOnce(new Error('about failed'))
    render(<AboutPanel />)
    expect(await screen.findByText('未知')).toBeInTheDocument()
    expect(await screen.findByText(/about failed/)).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('shows check-update failures as panel message without toast', async () => {
    useToastStore.setState({ toasts: [] })
    checkUpdate.mockRejectedValueOnce(new Error('update failed'))
    render(<AboutPanel />)
    await userEvent.click(await screen.findByRole('button', { name: '检查更新' }))
    expect(await screen.findByText('检查更新失败：update failed')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('shows download failures as panel message', async () => {
    downloadUpdate.mockRejectedValueOnce(new Error('download failed'))
    render(<AboutPanel />)
    await userEvent.click(await screen.findByRole('button', { name: '检查更新' }))
    await userEvent.click(await screen.findByRole('button', { name: '下载更新' }))
    expect(await screen.findByText('下载更新失败：download failed')).toBeInTheDocument()
  })

  it('styles English check-update failures as destructive', async () => {
    useLanguageStore.getState().setLanguage('en')
    checkUpdate.mockRejectedValueOnce(new Error('offline'))
    render(<AboutPanel />)

    await userEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Check for updates failed: offline')
    expect(alert).toHaveClass('text-destructive')
  })

  it('shows external link open failures as panel message without toast', async () => {
    useToastStore.setState({ toasts: [] })
    openURL.mockRejectedValueOnce(new Error('open blocked'))
    render(<AboutPanel />)
    await userEvent.click(await screen.findByRole('button', { name: 'GitHub 社区' }))
    expect(await screen.findByText(/open blocked/)).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })
})
