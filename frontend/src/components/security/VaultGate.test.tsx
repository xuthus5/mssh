import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { VaultGate } from '@/components/security/VaultGate'
import { useToastStore } from '@/components/ui/toast'

const security = vi.hoisted(() => ({
  Status: vi.fn(),
  Setup: vi.fn(),
  Unlock: vi.fn(),
}))
const sync = vi.hoisted(() => ({
  ImportWithPassword: vi.fn(),
}))
const dialogs = vi.hoisted(() => ({
  OpenFile: vi.fn(),
}))

vi.mock('@/lib/wails', () => ({ SecurityService: security, SyncService: sync }))
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wailsio/runtime')>()
  return {
    ...actual,
    Dialogs: { ...actual.Dialogs, OpenFile: dialogs.OpenFile },
  }
})

describe('VaultGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToastStore.setState({ toasts: [] })
  })

  it('forces setup when vault is not configured', async () => {
    const user = userEvent.setup()
    security.Status
      .mockResolvedValueOnce({
        configured: false, unlocked: false, require_password_on_launch: false, remember_unlock: true, updated_at: '',
      })
      .mockResolvedValueOnce({
        configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '',
      })
    security.Setup.mockResolvedValue({
      configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })

    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('首次使用需设置应用密码，用于加密本机敏感数据与云同步备份。')).toBeInTheDocument()
    expect(screen.queryByText('app-ready')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('应用密码'), 'password-1234')
    await user.type(screen.getByLabelText('确认应用密码'), 'password-1234')
    await user.click(screen.getByRole('button', { name: '创建应用密码' }))

    await waitFor(() => expect(security.Setup).toHaveBeenCalledWith(expect.objectContaining({
      password: 'password-1234', remember_unlock: true, require_password_on_launch: false,
    })))
    expect(await screen.findByText('app-ready')).toBeInTheDocument()
  })

  it('forces unlock when vault is configured but locked', async () => {
    const user = userEvent.setup()
    security.Status
      .mockResolvedValueOnce({
        configured: true, unlocked: false, require_password_on_launch: true, remember_unlock: false, updated_at: '',
      })
      .mockResolvedValueOnce({
        configured: true, unlocked: true, require_password_on_launch: true, remember_unlock: false, updated_at: '',
      })
    security.Unlock.mockResolvedValue({
      configured: true, unlocked: true, require_password_on_launch: true, remember_unlock: false, updated_at: '',
    })

    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('应用已锁定。请输入应用密码以继续。')).toBeInTheDocument()
    await user.type(screen.getByLabelText('应用密码'), 'password-1234')
    await user.click(screen.getByRole('button', { name: '解锁' }))
    await waitFor(() => expect(security.Unlock).toHaveBeenCalledWith({
      password: 'password-1234', remember_unlock: false,
    }))
    expect(await screen.findByText('app-ready')).toBeInTheDocument()
  })

  it('renders children when already unlocked', async () => {
    security.Status.mockResolvedValue({
      configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('app-ready')).toBeInTheDocument()
  })

  it('returns to unlock screen when vault-locked event fires', async () => {
    security.Status.mockResolvedValue({
      configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('app-ready')).toBeInTheDocument()
    await Events.Emit('security:vault-locked', { locked: true })
    expect(await screen.findByText('应用已锁定。请输入应用密码以继续。')).toBeInTheDocument()
  })

  it('restores vault from encrypted backup on first run', async () => {
    const user = userEvent.setup()
    security.Status
      .mockResolvedValueOnce({
        configured: false, unlocked: false, require_password_on_launch: false, remember_unlock: true, updated_at: '',
      })
      .mockResolvedValueOnce({
        configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '',
      })
    dialogs.OpenFile.mockResolvedValue('/tmp/device.msshbackup')
    sync.ImportWithPassword.mockResolvedValue(undefined)

    render(<VaultGate><div>app-ready</div></VaultGate>)
    await user.click(await screen.findByRole('button', { name: '我有其他设备的加密备份' }))
    await user.type(screen.getByLabelText('应用密码'), 'password-1234')
    await user.click(screen.getByRole('button', { name: '从加密备份恢复' }))
    await waitFor(() => expect(sync.ImportWithPassword).toHaveBeenCalledWith('/tmp/device.msshbackup', 'password-1234'))
    expect(await screen.findByText('app-ready')).toBeInTheDocument()
  })

  it('syncs setup completion from another window via vault-changed event', async () => {
    security.Status.mockResolvedValue({
      configured: false, unlocked: false, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('首次使用需设置应用密码，用于加密本机敏感数据与云同步备份。')).toBeInTheDocument()

    await Events.Emit('security:vault-changed', {
      configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })
    expect(await screen.findByText('app-ready')).toBeInTheDocument()
  })


  it('shows security status load failures inline without toast', async () => {
    security.Status.mockRejectedValueOnce(new Error('status failed'))
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('status failed')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('status failed')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
