import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TerminalLocalShellSettingsSection } from '@/components/settings/TerminalLocalShellSettings'

const CANDIDATES = ['/bin/bash', '/usr/bin/zsh', '/usr/bin/fish']

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
        candidates={CANDIDATES}
        onShellChange={onShellChange}
        onArgsChange={onArgsChange}
        onCwdChange={onCwdChange}
        onLoginChange={onLoginChange}
      />,
    )
    expect(screen.getByText('本地终端')).toBeInTheDocument()
    await user.type(screen.getByLabelText('启动参数'), '-i')
    expect(onArgsChange).toHaveBeenCalled()
  })

  it('renders preset shell candidates in the select', () => {
    render(<TerminalLocalShellSettingsSection shell="/usr/bin/fish" args="" cwd="" login={false} candidates={CANDIDATES} onShellChange={vi.fn()} onArgsChange={vi.fn()} onCwdChange={vi.fn()} onLoginChange={vi.fn()} />)
    expect(screen.getByText('/usr/bin/fish')).toBeInTheDocument()
  })

  it('shows system default label when shell is empty', () => {
    render(<TerminalLocalShellSettingsSection shell="" args="" cwd="" login={false} candidates={CANDIDATES} onShellChange={vi.fn()} onArgsChange={vi.fn()} onCwdChange={vi.fn()} onLoginChange={vi.fn()} />)
    expect(screen.getByText('系统默认')).toBeInTheDocument()
  })

  it('reveals a custom input when shell does not match a candidate', () => {
    render(<TerminalLocalShellSettingsSection shell="/opt/custom/bin/shell" args="" cwd="" login={false} candidates={CANDIDATES} onShellChange={vi.fn()} onArgsChange={vi.fn()} onCwdChange={vi.fn()} onLoginChange={vi.fn()} />)
    const input = screen.getByLabelText('Shell 路径（自定义）')
    expect(input).toHaveValue('/opt/custom/bin/shell')
  })

  it('selecting a preset candidate persists its path', async () => {
    const user = userEvent.setup()
    const onShellChange = vi.fn()
    render(<TerminalLocalShellSettingsSection shell="" args="" cwd="" login={false} candidates={CANDIDATES} onShellChange={onShellChange} onArgsChange={vi.fn()} onCwdChange={vi.fn()} onLoginChange={vi.fn()} />)
    await user.click(screen.getByLabelText('Shell 路径'))
    await user.click(await screen.findByText('/bin/bash'))
    expect(onShellChange).toHaveBeenCalledWith('/bin/bash')
  })

  it('persists the selected custom preset and reveals input', async () => {
    const user = userEvent.setup()
    const onShellChange = vi.fn()
    render(<TerminalLocalShellSettingsSection shell="" args="" cwd="" login={false} candidates={CANDIDATES} onShellChange={onShellChange} onArgsChange={vi.fn()} onCwdChange={vi.fn()} onLoginChange={vi.fn()} />)
    await user.click(screen.getByLabelText('Shell 路径'))
    await user.click(await screen.findByText('自定义…'))
    const input = screen.getByLabelText('Shell 路径（自定义）')
    expect(input).toBeInTheDocument()
    await user.type(input, '/usr/bin/zsh')
    expect(onShellChange).toHaveBeenCalled()
  })

  it('persists empty shell when selecting system default', async () => {
    const user = userEvent.setup()
    const onShellChange = vi.fn()
    render(<TerminalLocalShellSettingsSection shell="/bin/bash" args="" cwd="" login={false} candidates={CANDIDATES} onShellChange={onShellChange} onArgsChange={vi.fn()} onCwdChange={vi.fn()} onLoginChange={vi.fn()} />)
    await user.click(screen.getByLabelText('Shell 路径'))
    await user.click(await screen.findByText('系统默认'))
    expect(onShellChange).toHaveBeenCalledWith('')
  })
})