import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SecurityPanel } from '@/components/settings/SecurityPanel'
import { useToastStore } from '@/components/ui/toast'

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
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(session.DeleteHostKey).toHaveBeenCalledWith(1))
  })

  it('shows load failures instead of empty host keys without toast', async () => {
    useToastStore.setState({ toasts: [] })
    security.Status.mockRejectedValueOnce(new Error('status boom'))
    render(<SecurityPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('status boom')
    expect(screen.queryByText('尚未信任任何 SSH 主机。')).not.toBeInTheDocument()
    expect(screen.getByText(/主机指纹暂不可用/)).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })


  it('keeps password validation errors panel-owned without toast', async () => {
    useToastStore.setState({ toasts: [] })
    const user = userEvent.setup()
    render(<SecurityPanel />)
    expect(await screen.findByText('应用密码')).toBeInTheDocument()
    await user.type(screen.getByLabelText('设置应用密码'), 'short')
    await user.type(screen.getByLabelText('确认应用密码'), 'short')
    await user.click(screen.getByRole('button', { name: '创建应用密码' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('应用密码至少需要 12 个字符')
    expect(security.Setup).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('surfaces setup failures inline without toast', async () => {
    useToastStore.setState({ toasts: [] })
    security.Setup.mockRejectedValueOnce(new Error('setup boom'))
    const user = userEvent.setup()
    render(<SecurityPanel />)
    expect(await screen.findByText('应用密码')).toBeInTheDocument()
    await user.type(screen.getByLabelText('设置应用密码'), 'password-1234')
    await user.type(screen.getByLabelText('确认应用密码'), 'password-1234')
    await user.click(screen.getByRole('button', { name: '创建应用密码' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('设置应用密码失败: setup boom')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('surfaces host fingerprint delete failures inline without toast', async () => {
    useToastStore.setState({ toasts: [] })
    session.DeleteHostKey.mockRejectedValueOnce(new Error('delete boom'))
    render(<SecurityPanel />)
    expect(await screen.findByText('example.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '删除 example.com 的主机指纹' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(session.DeleteHostKey).toHaveBeenCalledWith(1))
    expect(await screen.findByText('删除主机指纹失败: delete boom')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

})
