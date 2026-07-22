import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TerminalLocalShellSettingsSection } from '@/components/settings/TerminalLocalShellSettings'

describe('TerminalLocalShellSettingsSection', () => {
  it('emits local shell setting updates', async () => {
    const user = userEvent.setup()
    const onShellChange = vi.fn()
    const onArgsChange = vi.fn()
    const onCwdChange = vi.fn()
    const onLoginChange = vi.fn()
    render(
      <TerminalLocalShellSettingsSection
        shell="/bin/bash"
        args="-l"
        cwd="/tmp"
        login
        onShellChange={onShellChange}
        onArgsChange={onArgsChange}
        onCwdChange={onCwdChange}
        onLoginChange={onLoginChange}
      />,
    )
    expect(screen.getByText('本地终端')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Shell 路径'))
    await user.type(screen.getByLabelText('Shell 路径'), '/bin/zsh')
    expect(onShellChange).toHaveBeenCalled()
  })
})
