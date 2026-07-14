import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TerminalBehaviorSettingsSection } from '@/components/settings/TerminalBehaviorSettings'

describe('TerminalBehaviorSettingsSection', () => {
  it('shows labels and emits controlled behavior changes', async () => {
    const onRightClickActionChange = vi.fn()
    const onCopyOnSelectChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TerminalBehaviorSettingsSection
        rightClickAction="menu"
        copyOnSelect={false}
        onRightClickActionChange={onRightClickActionChange}
        onCopyOnSelectChange={onCopyOnSelectChange}
      />,
    )

    expect(screen.getByText('行为')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '鼠标右键行为' })).toHaveTextContent('显示菜单')
    await user.click(screen.getByRole('combobox', { name: '鼠标右键行为' }))
    await user.click(screen.getByRole('option', { name: '粘贴' }))
    await user.click(screen.getByRole('switch', { name: '选择即复制' }))

    expect(onRightClickActionChange).toHaveBeenCalledWith('paste')
    expect(onCopyOnSelectChange).toHaveBeenCalledWith(true)
  })
})
