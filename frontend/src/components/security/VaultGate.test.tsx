import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { VaultGate } from '@/components/security/VaultGate'
import { useToastStore } from '@/components/ui/toast'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'
import type { SecurityStatus } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { syncDataChangedEvent } from '@/lib/syncDataReload'

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
    vi.resetAllMocks()
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

  it('rejects oversized passwords before calling unlock', async () => {
    security.Status.mockResolvedValue(lockedStatus())
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('应用已锁定。请输入应用密码以继续。')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('应用密码'), { target: { value: 'x'.repeat(1025) } })
    await userEvent.click(screen.getByRole('button', { name: '解锁' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('应用密码不能超过 1024 字节')
    expect(security.Unlock).not.toHaveBeenCalled()
  })

  it('rejects oversized passwords before opening backup restore', async () => {
    security.Status.mockResolvedValue({
      configured: false, unlocked: false, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })
    render(<VaultGate><div>app-ready</div></VaultGate>)
    await userEvent.click(await screen.findByRole('button', { name: '我有其他设备的加密备份' }))
    fireEvent.change(screen.getByLabelText('应用密码'), { target: { value: '密'.repeat(342) } })
    await userEvent.click(screen.getByRole('button', { name: '从加密备份恢复' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('应用密码不能超过 1024 字节')
    expect(dialogs.OpenFile).not.toHaveBeenCalled()
    expect(sync.ImportWithPassword).not.toHaveBeenCalled()
  })

  it('renders children when already unlocked', async () => {
    security.Status.mockResolvedValue({
      configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('app-ready')).toBeInTheDocument()
  })

  it('shows a dismissible banner when remembering unlock fails', async () => {
    security.Status.mockResolvedValue(unlockedStatus())
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('app-ready')).toBeInTheDocument()

    await act(async () => {
      await Events.Emit('security:remember-failed', { message: 'store remembered vault DEK: rejected' })
    })

    expect(await screen.findByText('系统钥匙串不可用')).toBeInTheDocument()
    expect(screen.getByText('store remembered vault DEK: rejected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByText('系统钥匙串不可用')).not.toBeInTheDocument()
  })

  it('clears the remember warning once unlock is remembered successfully', async () => {
    security.Status.mockResolvedValue(unlockedStatus())
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('app-ready')).toBeInTheDocument()

    await act(async () => {
      await Events.Emit('security:remember-failed', { message: 'boom' })
    })
    expect(await screen.findByText('系统钥匙串不可用')).toBeInTheDocument()

    await act(async () => {
      await Events.Emit('security:vault-changed', unlockedStatus())
    })
    await waitFor(() => expect(screen.queryByText('系统钥匙串不可用')).not.toBeInTheDocument())
  })

  it('revalidates security policy after synchronized data changes', async () => {
    security.Status
      .mockResolvedValueOnce(unlockedStatus())
      .mockResolvedValueOnce({ ...unlockedStatus(), require_password_on_launch: true })
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('app-ready')).toBeInTheDocument()

    await act(async () => { await Events.Emit(syncDataChangedEvent, { changed: true }) })

    await waitFor(() => expect(security.Status).toHaveBeenCalledTimes(2))
    expect(screen.getByText('app-ready')).toBeInTheDocument()
  })

  it('returns to unlock screen when vault-locked event fires', async () => {
    security.Status
      .mockResolvedValueOnce(unlockedStatus())
      .mockResolvedValueOnce(lockedStatus())
      .mockResolvedValue(lockedStatus())
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
    security.Status
      .mockResolvedValueOnce({
        configured: false, unlocked: false, require_password_on_launch: false, remember_unlock: true, updated_at: '',
      })
      .mockResolvedValueOnce(unlockedStatus())
      .mockResolvedValue(unlockedStatus())
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('首次使用需设置应用密码，用于加密本机敏感数据与云同步备份。')).toBeInTheDocument()

    await Events.Emit('security:vault-changed', {
      configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })
    expect(await screen.findByText('app-ready')).toBeInTheDocument()
  })

  it('revalidates every mounted gate after first-run setup in another window', async () => {
    let current = { ...unlockedStatus(), configured: false, unlocked: false }
    security.Status.mockImplementation(async () => current)
    render(<>
      <VaultGate><div>main-ready</div></VaultGate>
      <VaultGate><div>settings-ready</div></VaultGate>
    </>)
    expect(await screen.findAllByText('首次使用需设置应用密码，用于加密本机敏感数据与云同步备份。')).toHaveLength(2)

    current = unlockedStatus()
    await act(async () => { await Events.Emit('security:vault-changed', current) })

    expect(await screen.findByText('main-ready')).toBeInTheDocument()
    expect(await screen.findByText('settings-ready')).toBeInTheDocument()
    expect(security.Status).toHaveBeenCalledTimes(4)
  })


  it('shows security status load failures inline without toast', async () => {
    security.Status.mockRejectedValueOnce(new Error('status failed'))
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('status failed')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('status failed')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('does not let an older status request overwrite a vault event', async () => {
    const initial = deferred<SecurityStatus>()
    const eventRefresh = deferred<SecurityStatus>()
    let calls = 0
    security.Status.mockImplementation(() => {
      calls++
      return calls === 1 ? initial.promise : eventRefresh.promise
    })
    render(<VaultGate><div>app-ready</div></VaultGate>)
    await waitFor(() => expect(security.Status).toHaveBeenCalledOnce())
    await act(async () => { await Events.Emit('security:vault-changed', unlockedStatus()) })
    await waitFor(() => expect(security.Status).toHaveBeenCalledTimes(2))
    await act(async () => { eventRefresh.resolve(unlockedStatus()); await Promise.resolve() })
    expect(await screen.findByText('app-ready')).toBeInTheDocument()
    await act(async () => { initial.resolve({ ...unlockedStatus(), unlocked: false }); await Promise.resolve() })
    expect(screen.getByText('app-ready')).toBeInTheDocument()
  })

  it('does not let a stale unlocked event reopen the gate after locking', async () => {
    security.Status
      .mockResolvedValueOnce(unlockedStatus())
      .mockResolvedValueOnce(lockedStatus())
      .mockResolvedValueOnce(lockedStatus())
      .mockResolvedValue(lockedStatus())
    render(<VaultGate><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('app-ready')).toBeInTheDocument()

    await act(async () => { await Events.Emit('security:vault-locked', { locked: true }) })
    expect(await screen.findByText('应用已锁定。请输入应用密码以继续。')).toBeInTheDocument()

    await act(async () => { await Events.Emit('security:vault-changed', unlockedStatus()) })
    expect(screen.queryByText('app-ready')).not.toBeInTheDocument()
    expect(screen.getByText('应用已锁定。请输入应用密码以继续。')).toBeInTheDocument()
  })

  it('does not refresh security state after setup is unmounted', async () => {
    const setup = deferred<SecurityStatus>()
    security.Status.mockResolvedValue({ ...unlockedStatus(), configured: false, unlocked: false })
    security.Setup.mockImplementation(() => setup.promise)
    const user = userEvent.setup()
    const view = render(<VaultGate><div>app-ready</div></VaultGate>)
    await user.type(await screen.findByLabelText('应用密码'), 'password-1234')
    await user.type(screen.getByLabelText('确认应用密码'), 'password-1234')
    await user.click(screen.getByRole('button', { name: '创建应用密码' }))
    view.unmount()
    await act(async () => { setup.resolve(unlockedStatus()); await Promise.resolve() })
    expect(security.Status).toHaveBeenCalledOnce()
  })

  it('clears setup secrets on settings window hide when opted in', async () => {
    security.Status.mockResolvedValue({ ...unlockedStatus(), configured: false, unlocked: false })
    const user = userEvent.setup()
    render(<VaultGate clearOnSettingsHide><div>app-ready</div></VaultGate>)
    await user.type(await screen.findByLabelText('应用密码'), 'password-1234')
    await user.type(screen.getByLabelText('确认应用密码'), 'password-1234')

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.getByLabelText('应用密码')).toHaveValue('')
    expect(screen.getByLabelText('确认应用密码')).toHaveValue('')
  })

  it('does not clear the main window gate when settings window hides', async () => {
    security.Status.mockResolvedValue({ ...unlockedStatus(), configured: false, unlocked: false })
    const user = userEvent.setup()
    render(<VaultGate><div>app-ready</div></VaultGate>)
    await user.type(await screen.findByLabelText('应用密码'), 'password-1234')

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.getByLabelText('应用密码')).toHaveValue('password-1234')
  })

  it('keeps an in-flight status refresh valid when the settings window hides', async () => {
    const status = deferred<SecurityStatus>()
    security.Status.mockImplementation(() => status.promise)
    render(<VaultGate clearOnSettingsHide><div>app-ready</div></VaultGate>)
    expect(await screen.findByText('正在检查安全状态…')).toBeInTheDocument()

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })
    await act(async () => { status.resolve({ ...unlockedStatus(), configured: false, unlocked: false }); await status.promise })

    expect(screen.getByText('首次使用需设置应用密码，用于加密本机敏感数据与云同步备份。')).toBeInTheDocument()
  })

  it('ignores an operation failure that arrives after the settings window hides', async () => {
    const unlock = deferred<SecurityStatus>()
    security.Status.mockResolvedValue(lockedStatus())
    security.Unlock.mockImplementation(() => unlock.promise)
    const user = userEvent.setup()
    render(<VaultGate clearOnSettingsHide><div>app-ready</div></VaultGate>)
    await user.type(await screen.findByLabelText('应用密码'), 'password-1234')
    await user.click(screen.getByRole('button', { name: '解锁' }))

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })
    await act(async () => { unlock.reject(new Error('late unlock failure')); await Promise.resolve() })

    expect(screen.getByLabelText('应用密码')).toHaveValue('')
    expect(screen.queryByText('late unlock failure')).not.toBeInTheDocument()
  })

  it('keeps the restore picker lease after the settings window hides', async () => {
    const firstPicker = deferred<string>()
    security.Status
      .mockResolvedValueOnce({ ...unlockedStatus(), configured: false, unlocked: false })
      .mockResolvedValueOnce(unlockedStatus())
    dialogs.OpenFile
      .mockImplementationOnce(() => firstPicker.promise)
      .mockResolvedValueOnce('/tmp/fresh.msshbackup')
    sync.ImportWithPassword.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<VaultGate clearOnSettingsHide><div>app-ready</div></VaultGate>)
    await user.click(await screen.findByRole('button', { name: '我有其他设备的加密备份' }))
    await user.type(screen.getByLabelText('应用密码'), 'password-1234')
    await user.click(screen.getByRole('button', { name: '从加密备份恢复' }))
    expect(screen.getByLabelText('应用密码')).toBeDisabled()

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })
    const enterRestore = screen.getByRole('button', { name: '我有其他设备的加密备份' })
    expect(enterRestore).toBeDisabled()
    await user.click(enterRestore)
    expect(dialogs.OpenFile).toHaveBeenCalledOnce()

    await act(async () => { firstPicker.resolve('/tmp/stale.msshbackup'); await Promise.resolve() })
    expect(sync.ImportWithPassword).not.toHaveBeenCalled()
    await waitFor(() => expect(enterRestore).toBeEnabled())
    await user.click(enterRestore)
    await user.type(screen.getByLabelText('应用密码'), 'password-5678')
    await user.click(screen.getByRole('button', { name: '从加密备份恢复' }))
    await waitFor(() => expect(dialogs.OpenFile).toHaveBeenCalledTimes(2))
    expect(sync.ImportWithPassword).toHaveBeenCalledWith('/tmp/fresh.msshbackup', 'password-5678')
  })
})

function unlockedStatus(): SecurityStatus {
  return { configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '' }
}

function lockedStatus(): SecurityStatus {
  return { ...unlockedStatus(), unlocked: false }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
