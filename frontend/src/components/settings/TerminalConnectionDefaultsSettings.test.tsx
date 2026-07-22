import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TerminalConnectionDefaultsSettingsSection } from '@/components/settings/TerminalConnectionDefaultsSettings'

describe('TerminalConnectionDefaultsSettingsSection', () => {
  it('renders connection defaults and emits controlled updates', async () => {
    const onMaxPoolSizeChange = vi.fn()
    const onDefaultKeepAliveChange = vi.fn()
    const onDefaultTermTypeChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TerminalConnectionDefaultsSettingsSection
        maxPoolSize="10"
        defaultKeepAlive="60"
        defaultTermType="xterm-256color"
        onMaxPoolSizeChange={onMaxPoolSizeChange}
        onDefaultKeepAliveChange={onDefaultKeepAliveChange}
        onDefaultTermTypeChange={onDefaultTermTypeChange}
      />,
    )

    expect(screen.getByText('连接默认')).toBeInTheDocument()
    await user.clear(screen.getByRole('spinbutton', { name: '最大终端池大小' }))
    await user.type(screen.getByRole('spinbutton', { name: '最大终端池大小' }), '16')
    await user.clear(screen.getByRole('spinbutton', { name: '默认保活间隔 (秒)' }))
    await user.type(screen.getByRole('spinbutton', { name: '默认保活间隔 (秒)' }), '90')
    await user.click(screen.getByRole('combobox', { name: '默认终端类型' }))
    await user.click(await screen.findByRole('option', { name: 'xterm' }))

    expect(onMaxPoolSizeChange).toHaveBeenCalled()
    expect(onDefaultKeepAliveChange).toHaveBeenCalled()
    expect(onDefaultTermTypeChange).toHaveBeenCalledWith('xterm')
  })
})
