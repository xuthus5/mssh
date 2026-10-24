import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionDialog from '@/components/session/SessionDialog'
import type { AssetColorToken } from '@/lib/sessionModels'

vi.mock('@/lib/wails', () => ({ KeyService: { List: vi.fn(async () => []) }, SessionService: { TestSSHJumpHost: vi.fn() } }))

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  session: undefined as undefined | null,
  onSave: vi.fn(),
  environments: [],
  projects: [],
  assetTags: [],
  onCreateEnvironment: vi.fn(async (name: string, colorToken: AssetColorToken) => ({ id: 'environment-1', name, colorToken, sortOrder: 0, sessionCount: 0 })),
  onCreateProject: vi.fn(async (name: string, code: string) => ({ id: 'project-1', name, code, description: '', sortOrder: 0, sessionCount: 0 })),
  onCreateTag: vi.fn(async (name: string, colorToken: AssetColorToken) => ({ id: 'tag-1', name, colorToken, sessionCount: 0 })),
}

describe('SessionDialog startup command', () => {
  beforeEach(() => {
    defaultProps.onOpenChange = vi.fn()
    defaultProps.onSave = vi.fn()
    defaultProps.session = undefined
  })

  it('saves a trimmed multiline startup command', async () => {
    const user = userEvent.setup()
    render(<SessionDialog {...defaultProps} />)
    await user.type(screen.getByLabelText('名称'), 'app')
    await user.type(screen.getByLabelText('主机'), '10.0.0.1')
    await user.type(screen.getByLabelText('用户名'), 'root')
    await user.click(screen.getByRole('button', { name: '终端选项' }))
    await user.type(screen.getByLabelText('登录后执行命令'), '  cd /srv/app{enter}./run.sh  ')
    await user.click(screen.getByRole('button', { name: '创建会话' }))

    expect(defaultProps.onSave).toHaveBeenCalledWith(expect.objectContaining({
      startupCommand: 'cd /srv/app\n./run.sh',
    }))
  })

  it('prefills the command when editing', async () => {
    const user = userEvent.setup()
    render(<SessionDialog {...defaultProps} session={{
      id: '1', name: 'app', host: '10.0.0.1', port: 22, username: 'root', authMethod: 'agent',
      keepAlive: 30, termType: 'xterm-256color', startupCommand: 'tmux attach || tmux new', folderId: null,
    }} />)

    const terminalToggle = screen.getByRole('button', { name: '终端选项' })
    expect(terminalToggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(terminalToggle)
    expect(screen.getByLabelText('登录后执行命令')).toHaveValue('tmux attach || tmux new')
  })
})
