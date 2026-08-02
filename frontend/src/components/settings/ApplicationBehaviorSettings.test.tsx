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
        debug={false}
        onDebugChange={() => undefined}
        onCloseButtonActionChange={onCloseButtonActionChange}
      />,
    )

    const select = screen.getByRole('combobox', { name: '关闭按钮行为' })
    expect(select).toHaveTextContent('最小化到托盘')
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: '关闭应用' }))
    expect(onCloseButtonActionChange).toHaveBeenCalledWith('exit')
  })

  it('shows the debug switch with a restart hint and emits changes', async () => {
    const onDebugChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ApplicationBehaviorSettingsSection
        closeButtonAction="tray"
        debug={false}
        onDebugChange={onDebugChange}
        onCloseButtonActionChange={() => undefined}
      />,
    )

    const toggle = screen.getByRole('switch', { name: '应用调试' })
    expect(toggle).not.toBeChecked()
    expect(screen.getByText('启用开发者工具（Web 检查器）。更改后需重启应用才能生效，默认关闭。')).toBeInTheDocument()
    await user.click(toggle)
    expect(onDebugChange).toHaveBeenCalledWith(true)
  })
})
