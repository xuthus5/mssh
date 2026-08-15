import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { SecurityPanel } from '@/components/settings/SecurityPanel'
import { useToastStore } from '@/components/ui/toast'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'
import type { SecurityStatus } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { syncDataChangedEvent } from '@/lib/syncDataReload'

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
const settings = vi.hoisted(() => ({
  Get: vi.fn(),
  Set: vi.fn(),
}))

vi.mock('@/lib/wails', () => ({ SecurityService: security, SessionService: session, SettingService: settings }))

describe('SecurityPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useToastStore.setState({ toasts: [] })
    security.Status.mockResolvedValue({
      configured: false, unlocked: false, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })
    session.ListHostKeys.mockResolvedValue([{ line: 1, hosts: 'example.com', algorithm: 'ssh-ed25519', fingerprint: 'SHA256:test' }])
    session.DeleteHostKey.mockResolvedValue(undefined)
    security.Setup.mockResolvedValue({
      configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '2026-07-21T00:00:00Z',
    })
    settings.Get.mockResolvedValue(null)
    settings.Set.mockResolvedValue(undefined)
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

  it('shows the fingerprint change policy config and defaults to block', async () => {
    settings.Get.mockResolvedValue(null)
    render(<SecurityPanel />)
    expect(await screen.findByText('指纹变化时')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '指纹变化时' })).toHaveTextContent('阻止')
    expect(settings.Get).toHaveBeenCalledWith('security.host_key_change_policy')
  })

  it('loads the saved fingerprint change policy', async () => {
    settings.Get.mockResolvedValue({ key: 'security.host_key_change_policy', namespace: 'security', value: '"warn"', value_type: 'string', version: 1 })
    render(<SecurityPanel />)
    expect(await screen.findByRole('combobox', { name: '指纹变化时' })).toHaveTextContent('提醒')
  })

  it('saves the fingerprint change policy on selection', async () => {
    settings.Get.mockResolvedValue(null)
    const user = userEvent.setup()
    render(<SecurityPanel />)
    await user.click(await screen.findByRole('combobox', { name: '指纹变化时' }))
    await user.click(await screen.findByRole('option', { name: '默认信任' }))
    await waitFor(() => expect(settings.Set).toHaveBeenCalledWith(expect.objectContaining({
      key: 'security.host_key_change_policy', value: '"trust"',
    })))
  })

  it('shows fingerprint policy load failures inline without toast', async () => {
    useToastStore.setState({ toasts: [] })
    settings.Get.mockRejectedValueOnce(new Error('policy boom'))
    render(<SecurityPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('policy boom')
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

  it('rejects application passwords exceeding the UTF-8 byte limit', async () => {
    render(<SecurityPanel />)
    expect(await screen.findByText('应用密码')).toBeInTheDocument()
    const oversized = '密'.repeat(342)
    fireEvent.change(screen.getByLabelText('设置应用密码'), { target: { value: oversized } })
    fireEvent.change(screen.getByLabelText('确认应用密码'), { target: { value: oversized } })
    await userEvent.click(screen.getByRole('button', { name: '创建应用密码' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('应用密码不能超过 1024 字节')
    expect(security.Setup).not.toHaveBeenCalled()
  })

  it('rejects an oversized current password before unlock or rotation', async () => {
    security.Status.mockResolvedValue({
      configured: true, unlocked: false, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })
    render(<SecurityPanel />)
    expect(await screen.findByText(/已配置 · 已锁定/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'x'.repeat(1025) } })
    await userEvent.click(screen.getByRole('button', { name: '解锁' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('应用密码不能超过 1024 字节')
    expect(security.Unlock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-password-1234' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-password-1234' } })
    await userEvent.click(screen.getByRole('button', { name: '轮转密码并重加密' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(security.Rotate).not.toHaveBeenCalled()
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

  it('keeps persisted security preferences when saving a toggle fails', async () => {
    security.Status.mockResolvedValue({
      configured: true, unlocked: true, require_password_on_launch: false, remember_unlock: true, updated_at: '',
    })
    security.SavePreferences.mockRejectedValueOnce(new Error('save boom'))
    const user = userEvent.setup()
    render(<SecurityPanel />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '每次启动都要求输入应用密码' })).not.toHaveAttribute('aria-disabled', 'true'))
    const requireLaunch = screen.getByRole('checkbox', { name: '每次启动都要求输入应用密码' })
    expect(requireLaunch).not.toBeChecked()
    expect(requireLaunch).toBeEnabled()

    await user.click(requireLaunch)

    await waitFor(() => expect(security.SavePreferences).toHaveBeenCalledWith({
      require_password_on_launch: true, remember_unlock: true,
    }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存安全偏好失败: save boom')
    expect(requireLaunch).not.toBeChecked()
  })

  it('updates security preferences only after the saved status reloads', async () => {
    const saved = { ...emptyStatus(), configured: true, unlocked: true, require_password_on_launch: true }
    const save = deferred<SecurityStatus>()
    security.Status
      .mockResolvedValueOnce({ ...saved, require_password_on_launch: false })
      .mockResolvedValue(saved)
    security.SavePreferences.mockImplementation(() => save.promise)
    const user = userEvent.setup()
    render(<SecurityPanel />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '每次启动都要求输入应用密码' })).not.toHaveAttribute('aria-disabled', 'true'))

    await user.click(screen.getByRole('checkbox', { name: '每次启动都要求输入应用密码' }))
    expect(screen.getByRole('checkbox', { name: '每次启动都要求输入应用密码' })).not.toBeChecked()

    await act(async () => { save.resolve(saved); await Promise.resolve() })
    expect(await screen.findByRole('checkbox', { name: '每次启动都要求输入应用密码', checked: true })).toBeInTheDocument()
  })

  it('coalesces its own vault event with the action status reload', async () => {
    const locked = { ...emptyStatus(), configured: true, unlocked: false }
    security.Status
      .mockResolvedValueOnce({ ...locked, unlocked: true })
      .mockResolvedValue(locked)
    security.Lock.mockImplementation(async () => {
      await Events.Emit('security:vault-locked', { locked: true })
      return locked
    })
    const user = userEvent.setup()
    render(<SecurityPanel />)
    await user.click(await screen.findByRole('button', { name: '锁定' }))

    await waitFor(() => expect(useToastStore.getState().toasts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'success', message: '已锁定' }),
    ])))
    expect(security.Status).toHaveBeenCalledTimes(2)
  })

  it('surfaces fingerprint policy save failures inline without toast', async () => {
    useToastStore.setState({ toasts: [] })
    settings.Get.mockResolvedValue(null)
    settings.Set.mockRejectedValueOnce(new Error('save boom'))
    const user = userEvent.setup()
    render(<SecurityPanel />)
    await user.click(await screen.findByRole('combobox', { name: '指纹变化时' }))
    await user.click(await screen.findByRole('option', { name: '提醒' }))
    expect(await screen.findByText('保存指纹策略失败: save boom')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('reloads security status when another window changes the vault', async () => {
    security.Status
      .mockResolvedValueOnce(emptyStatus())
      .mockResolvedValue({ ...emptyStatus(), configured: true, unlocked: true, updated_at: '2026-07-26T00:00:00Z' })
    render(<SecurityPanel />)
    expect(await screen.findByText(/状态：未配置/)).toBeInTheDocument()

    await act(async () => { await Events.Emit('security:vault-changed', { configured: true, unlocked: true }) })

    expect(await screen.findByText(/状态：已配置 · 已解锁/)).toBeInTheDocument()
    expect(security.Status).toHaveBeenCalledTimes(2)
  })

  it('reloads security preferences after synchronized data changes', async () => {
    security.Status
      .mockResolvedValueOnce({ ...emptyStatus(), configured: true, unlocked: true })
      .mockResolvedValueOnce({ ...emptyStatus(), configured: true, unlocked: true, require_password_on_launch: true })
    render(<SecurityPanel />)
    expect(await screen.findByRole('checkbox', { name: '每次启动都要求输入应用密码' })).not.toBeChecked()

    await act(async () => { await Events.Emit(syncDataChangedEvent, { changed: true }) })

    expect(await screen.findByRole('checkbox', { name: '每次启动都要求输入应用密码', checked: true })).toBeInTheDocument()
  })

  it('clears password rotation secrets and confirmation when the settings window hides', async () => {
    security.Status.mockResolvedValue({ ...emptyStatus(), configured: true, unlocked: true })
    const user = userEvent.setup()
    render(<SecurityPanel />)
    await user.type(await screen.findByLabelText('当前密码'), 'current-password')
    await user.type(screen.getByLabelText('新密码'), 'new-password-1234')
    await user.type(screen.getByLabelText('确认新密码'), 'new-password-1234')
    await user.click(screen.getByRole('button', { name: '轮转密码并重加密' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.getByLabelText('当前密码')).toHaveValue('')
    expect(screen.getByLabelText('新密码')).toHaveValue('')
    expect(screen.getByLabelText('确认新密码')).toHaveValue('')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('does not show a success toast after an operation is unmounted', async () => {
    const setup = deferred<SecurityStatus>()
    security.Setup.mockImplementation(() => setup.promise)
    useToastStore.setState({ toasts: [] })
    const user = userEvent.setup()
    const view = render(<SecurityPanel />)
    expect(await screen.findByText('应用密码')).toBeInTheDocument()
    await user.type(screen.getByLabelText('设置应用密码'), 'password-1234')
    await user.type(screen.getByLabelText('确认应用密码'), 'password-1234')
    await user.click(screen.getByRole('button', { name: '创建应用密码' }))
    view.unmount()
    await act(async () => { setup.resolve({ ...emptyStatus(), configured: true }); await Promise.resolve() })
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

})

function emptyStatus(): SecurityStatus {
  return { configured: false, unlocked: false, require_password_on_launch: false, remember_unlock: true, updated_at: '' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
