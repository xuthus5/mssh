import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationBehaviorSettingsSection } from '@/components/settings/ApplicationBehaviorSettings'

describe('ApplicationBehaviorSettingsSection', () => {
  it('shows the selected close behavior label and emits changes', async () => {
    const onCloseButtonActionChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ApplicationBehaviorSettingsSection
        closeButtonAction="tray"
        onCloseButtonActionChange={onCloseButtonActionChange}
      />,
    )

    const select = screen.getByRole('combobox', { name: '关闭按钮行为' })
    expect(select).toHaveTextContent('最小化到托盘')
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: '关闭应用' }))
    expect(onCloseButtonActionChange).toHaveBeenCalledWith('exit')
  })
})
