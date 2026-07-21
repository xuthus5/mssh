import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SecurityPanel } from '@/components/settings/SecurityPanel'

const security = vi.hoisted(() => ({
  Status: vi.fn(),
  Setup: vi.fn(),
  Rotate: vi.fn(),
  SavePreferences: vi.fn(),
  Unlock: vi.fn(),
  Lock: vi.fn(),
}))
const session = vi.hoisted(() => ({
  ListHostKeys: vi.fn(),
  DeleteHostKey: vi.fn(),
}))

vi.mock('@/lib/wails', () => ({ SecurityService: security, SessionService: session }))

describe('SecurityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    security.Status.mockResolvedValue({
      configured: false, unlocked: false, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })
    session.ListHostKeys.mockResolvedValue([{ line: 1, hosts: 'example.com', algorithm: 'ssh-ed25519', fingerprint: 'SHA256:test' }])
    session.DeleteHostKey.mockResolvedValue(undefined)
    security.Setup.mockResolvedValue({
      configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '2026-07-21T00:00:00Z',
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('shows application password card first and sets up a password', async () => {
    const user = userEvent.setup()
    render(<SecurityPanel />)
    expect(await screen.findByText('应用密码')).toBeInTheDocument()
    expect(screen.getByText('已信任主机')).toBeInTheDocument()
    await user.type(screen.getByLabelText('设置应用密码'), 'password-1234')
    await user.type(screen.getByLabelText('确认应用密码'), 'password-1234')
    await user.click(screen.getByRole('button', { name: '创建应用密码' }))
    await waitFor(() => expect(security.Setup).toHaveBeenCalledWith(expect.objectContaining({
      password: 'password-1234', remember_unlock: true, require_password_on_launch: false,
    })))
  })

  it('lists and deletes trusted host fingerprints', async () => {
    render(<SecurityPanel />)
    expect(await screen.findByText('example.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '删除 example.com 的主机指纹' }))
    expect(session.DeleteHostKey).toHaveBeenCalledWith(1)
  })
})
