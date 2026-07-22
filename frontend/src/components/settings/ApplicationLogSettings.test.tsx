import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationLogSettingsSection } from '@/components/settings/ApplicationLogSettings'

const openFile = vi.fn()
vi.mock('@wailsio/runtime', () => ({ Dialogs: { OpenFile: (...args: unknown[]) => openFile(...args) } }))

describe('ApplicationLogSettingsSection', () => {
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
})
