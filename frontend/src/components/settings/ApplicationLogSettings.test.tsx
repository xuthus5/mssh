import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { ApplicationLogSettingsSection } from '@/components/settings/ApplicationLogSettings'
import { useToastStore } from '@/components/ui/toast'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'

const { openFile } = vi.hoisted(() => ({ openFile: vi.fn() }))
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const runtime = await importOriginal<typeof import('@wailsio/runtime')>()
  return { ...runtime, Dialogs: { ...runtime.Dialogs, OpenFile: (...args: unknown[]) => openFile(...args) } }
})

describe('ApplicationLogSettingsSection', () => {
  beforeEach(() => {
    openFile.mockReset()
    useToastStore.setState({ toasts: [] })
  })

  it('edits retention and picks a directory', async () => {
    const onLogDirChange = vi.fn()
    const onLogRetentionDaysChange = vi.fn()
    openFile.mockResolvedValue('/home/user/mssh-logs')
    const user = userEvent.setup()
    render(
      <ApplicationLogSettingsSection
        logDir=""
        logRetentionDays="30"
        onLogDirChange={onLogDirChange}
        onLogRetentionDaysChange={onLogRetentionDaysChange}
      />,
    )
    await user.clear(screen.getByLabelText('日志保留天数'))
    await user.type(screen.getByLabelText('日志保留天数'), '14')
    expect(onLogRetentionDaysChange).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /浏览/ }))
    expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ CanChooseDirectories: true, CanChooseFiles: false }))
    expect(onLogDirChange).toHaveBeenCalledWith('/home/user/mssh-logs')
  })

  it('shows directory picker failures inline without toast', async () => {
    openFile.mockRejectedValueOnce(new Error('picker failed'))
    const user = userEvent.setup()
    render(
      <ApplicationLogSettingsSection
        logDir=""
        logRetentionDays="30"
        onLogDirChange={vi.fn()}
        onLogRetentionDaysChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /浏览/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('选择日志目录失败: picker failed')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('locks the log directory draft while the native picker is pending', async () => {
    const picker = deferred<string>()
    openFile.mockReturnValueOnce(picker.promise)
    const onLogDirChange = vi.fn()
    render(
      <ApplicationLogSettingsSection
        logDir="/home/user/current-logs"
        logRetentionDays="30"
        onLogDirChange={onLogDirChange}
        onLogRetentionDaysChange={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /浏览/ }))

    expect(screen.getByLabelText('日志目录')).toBeDisabled()
    expect(screen.getByLabelText('日志保留天数')).toBeEnabled()
    await act(async () => { picker.resolve('/home/user/new-logs'); await picker.promise })
    await waitFor(() => expect(screen.getByLabelText('日志目录')).toBeEnabled())
    expect(onLogDirChange).toHaveBeenCalledWith('/home/user/new-logs')
  })

  it('ignores a directory result that arrives after the settings window hides', async () => {
    let resolvePicker: ((path: string) => void) | undefined
    openFile.mockReturnValue(new Promise<string>((resolve) => { resolvePicker = resolve }))
    const onLogDirChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ApplicationLogSettingsSection
        logDir=""
        logRetentionDays="30"
        onLogDirChange={onLogDirChange}
        onLogRetentionDaysChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /浏览/ }))
    expect(screen.getByRole('button', { name: /选择中/ })).toBeDisabled()
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })
    await act(async () => { resolvePicker?.('/home/user/stale-logs') })

    expect(onLogDirChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /浏览/ })).toBeEnabled()
  })

})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
