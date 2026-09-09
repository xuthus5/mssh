import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SessionDialog from '@/components/session/SessionDialog'
import type { Session } from '@/hooks/useSession'
import type { SessionDialogProps } from '@/components/session/useSessionDialogController'

const services = vi.hoisted(() => ({ listKeys: vi.fn(), testJumpHost: vi.fn() }))
vi.mock('@/lib/wails', () => ({
  KeyService: { List: services.listKeys },
  SessionService: { TestSSHJumpHost: services.testJumpHost },
}))

function sessionWithJumpHost(overrides: Partial<Session> = {}): Session {
  return {
    id: '12', name: 'internal', host: '10.10.0.8', port: 22, username: 'root',
    authMethod: 'agent', keepAlive: 0, termType: 'xterm-256color', folderId: null,
    jumpHost: { host: 'bastion.example.com', port: 22, username: 'deploy', authMethod: 'password' },
    ...overrides,
  }
}

function dialogProps(session?: Session): SessionDialogProps {
  return {
    open: true, onOpenChange: vi.fn(), onSave: vi.fn(async () => undefined), session,
    environments: [], projects: [], assetTags: [],
    onCreateEnvironment: vi.fn(), onCreateProject: vi.fn(), onCreateTag: vi.fn(),
  }
}

function fillJumpHost(values: { host?: string; port?: string; username?: string; password?: string } = {}) {
  fireEvent.change(screen.getByLabelText('隧道主机'), { target: { value: values.host ?? 'bastion.example.com' } })
  fireEvent.change(screen.getByLabelText('隧道端口'), { target: { value: values.port ?? '22' } })
  fireEvent.change(screen.getByLabelText('隧道用户名'), { target: { value: values.username ?? 'deploy' } })
  fireEvent.change(screen.getByLabelText('隧道密码'), { target: { value: values.password ?? 'jump-secret' } })
}

function deferredCall() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline })
  const cancelOn = vi.fn((_signal: AbortSignal) => promise)
  return { promise: Object.assign(promise, { cancelOn }), resolve, reject, cancelOn }
}

describe('SessionDialog SSH jump host', () => {
  beforeEach(() => {
    services.listKeys.mockReset().mockResolvedValue([])
    services.testJumpHost.mockReset().mockResolvedValue(undefined)
  })

  it('keeps the SSH connection tunnel disabled and hidden by default', async () => {
    await act(async () => { render(<SessionDialog {...dialogProps()} />) })
    expect(screen.getByRole('switch', { name: '启用 SSH 连接隧道' })).not.toBeChecked()
    expect(screen.queryByLabelText('隧道主机')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '测试隧道连接' })).not.toBeInTheDocument()
  })

  it('reveals jump host settings with port 22 only after enabling the tunnel', async () => {
    render(<SessionDialog {...dialogProps()} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用 SSH 连接隧道' }))
    expect(screen.getByLabelText('隧道主机')).toHaveValue('')
    expect(screen.getByLabelText('隧道端口')).toHaveValue(22)
    expect(screen.getByLabelText('隧道用户名')).toHaveValue('')
    expect(screen.getByLabelText('隧道密码')).toHaveAttribute('type', 'password')
    expect(screen.getByText('先登录跳板机，再访问内网中的目标主机。')).toBeInTheDocument()
    expect(screen.getByText('测试仅验证跳板机登录，目标主机在连接时验证。')).toBeInTheDocument()
  })

  it('saves a trimmed jump host independently from target credentials', async () => {
    const props = dialogProps(sessionWithJumpHost({ jumpHost: undefined }))
    render(<SessionDialog {...props} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用 SSH 连接隧道' }))
    fillJumpHost({ host: ' bastion.example.com ', port: '2222', username: ' deploy ' })
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({
      host: '10.10.0.8', username: 'root', authMethod: 'agent',
      jumpHost: { host: 'bastion.example.com', port: 2222, username: 'deploy', authMethod: 'password', password: 'jump-secret', keyId: undefined },
    }))
  })

  it('preserves a saved jump password when its identity stays unchanged', async () => {
    const props = dialogProps(sessionWithJumpHost())
    render(<SessionDialog {...props} />)
    expect(screen.getByRole('switch', { name: '启用 SSH 连接隧道' })).toBeChecked()
    expect(screen.getByLabelText('隧道密码')).toHaveAttribute('placeholder', '留空则保留原密码')
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(services.testJumpHost).toHaveBeenCalledWith({
      session_id: 12, request_id: expect.any(String),
      jump_host: { host: 'bastion.example.com', port: 22, username: 'deploy', auth_method: 'password', password: '', key_id: null },
    })
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ jumpHost: expect.objectContaining({ password: '' }) }))
  })

  it.each(['隧道主机', '隧道用户名', '隧道端口'])('does not promise password reuse after changing %s', async (label) => {
    render(<SessionDialog {...dialogProps(sessionWithJumpHost())} />)
    fireEvent.change(screen.getByLabelText(label), { target: { value: label === '隧道端口' ? '2222' : 'different' } })
    expect(screen.getByLabelText('隧道密码')).toHaveAttribute('placeholder', '输入跳板机密码')
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(services.testJumpHost).toHaveBeenCalledWith(expect.objectContaining({
      jump_host: expect.objectContaining({ password: '' }),
    }))
  })

  it('tests only the unsaved jump settings without requiring target settings', async () => {
    const props = dialogProps()
    render(<SessionDialog {...props} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用 SSH 连接隧道' }))
    fillJumpHost({ port: '2200' })
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(services.testJumpHost).toHaveBeenCalledWith({
      session_id: 0, request_id: expect.any(String),
      jump_host: { host: 'bastion.example.com', port: 2200, username: 'deploy', auth_method: 'password', password: 'jump-secret', key_id: null },
    })
    expect(await screen.findByRole('status')).toHaveTextContent('SSH 连接隧道测试成功')
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onOpenChange).not.toHaveBeenCalled()
  })

  it.each([
    { values: { host: ' ' }, error: '请输入隧道主机' },
    { values: { port: '0' }, error: '隧道端口必须为 1–65535 的整数' },
    { values: { port: '65536' }, error: '隧道端口必须为 1–65535 的整数' },
    { values: { port: '22.5' }, error: '隧道端口必须为 1–65535 的整数' },
    { values: { port: '' }, error: '隧道端口必须为 1–65535 的整数' },
    { values: { username: ' ' }, error: '请输入隧道用户名' },
  ])('validates jump settings before testing: $error $values', async ({ values, error }) => {
    render(<SessionDialog {...dialogProps()} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用 SSH 连接隧道' }))
    fillJumpHost(values)
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(error)
    expect(services.testJumpHost).not.toHaveBeenCalled()
  })

  it('permits an empty password so the server can decide authentication', async () => {
    render(<SessionDialog {...dialogProps()} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用 SSH 连接隧道' }))
    fillJumpHost({ password: '' })
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(services.testJumpHost).toHaveBeenCalledWith(expect.objectContaining({
      jump_host: expect.objectContaining({ password: '' }),
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('SSH 连接隧道测试成功')
  })

  it('validates jump credentials on submit even if browser validation is bypassed', async () => {
    const props = dialogProps(sessionWithJumpHost({ jumpHost: undefined }))
    render(<SessionDialog {...props} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用 SSH 连接隧道' }))
    fireEvent.submit(screen.getByRole('button', { name: '保存' }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入隧道主机')
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('clears results and removes the jump host from saved data when disabled', async () => {
    const props = dialogProps(sessionWithJumpHost())
    render(<SessionDialog {...props} />)
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(await screen.findByRole('status')).toHaveTextContent('SSH 连接隧道测试成功')
    await userEvent.click(screen.getByRole('switch', { name: '启用 SSH 连接隧道' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('隧道主机')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ jumpHost: undefined }))
  })

  it('supports key authentication and requires an available key selection', async () => {
    services.listKeys.mockResolvedValue([{ id: 7, name: 'bastion-key', type: 'ed25519' }])
    const props = dialogProps(sessionWithJumpHost())
    render(<SessionDialog {...props} />)
    await userEvent.click(screen.getByRole('combobox', { name: '隧道认证方式' }))
    await userEvent.click(await screen.findByRole('option', { name: '密钥' }))
    expect(screen.queryByLabelText('隧道密码')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请选择隧道 SSH 密钥')
    await userEvent.click(screen.getByRole('combobox', { name: '隧道 SSH 密钥' }))
    await userEvent.click(await screen.findByRole('option', { name: 'bastion-key (ed25519)' }))
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(services.testJumpHost).toHaveBeenCalledWith(expect.objectContaining({
      jump_host: expect.objectContaining({ auth_method: 'key', password: undefined, key_id: 7 }),
    }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({
      jumpHost: expect.objectContaining({ authMethod: 'key', keyId: '7', password: undefined }),
    }))
  })

  it('shows unavailable key guidance and key list errors inline', async () => {
    const props = dialogProps(sessionWithJumpHost({ jumpHost: { host: 'jump', port: 22, username: 'u', authMethod: 'key' } }))
    const view = render(<SessionDialog {...props} />)
    expect(await screen.findByText('暂无可用密钥，请先在总览 → 密钥配置中导入')).toBeInTheDocument()
    view.rerender(<SessionDialog {...props} open={false} />)
    services.listKeys.mockRejectedValueOnce(new Error('key list unavailable'))
    view.rerender(<SessionDialog {...props} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('加载密钥列表失败: key list unavailable')
  })

  it('supports agent authentication without a password or key selection', async () => {
    const props = dialogProps(sessionWithJumpHost())
    render(<SessionDialog {...props} />)
    await userEvent.click(screen.getByRole('combobox', { name: '隧道认证方式' }))
    await userEvent.click(await screen.findByRole('option', { name: 'SSH Agent' }))
    expect(screen.queryByLabelText('隧道密码')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('隧道 SSH 密钥')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({
      jumpHost: expect.objectContaining({ authMethod: 'agent', password: undefined, keyId: undefined }),
    }))
  })

  it('uses a separate password for keyboard-interactive authentication', async () => {
    const props = dialogProps(sessionWithJumpHost())
    render(<SessionDialog {...props} />)
    await userEvent.click(screen.getByRole('combobox', { name: '隧道认证方式' }))
    await userEvent.click(await screen.findByRole('option', { name: '交互式认证' }))
    expect(screen.getByLabelText('隧道密码')).toHaveAttribute('placeholder', '输入跳板机密码')
    fireEvent.change(screen.getByLabelText('隧道密码'), { target: { value: 'interactive-secret' } })
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({
      jumpHost: expect.objectContaining({ authMethod: 'keyboard-interactive', password: 'interactive-secret' }),
    }))
  })

  it.each([new Error('login refused'), 'channel refused'])('shows test errors inline and permits retry: %s', async (error) => {
    services.testJumpHost.mockRejectedValueOnce(error)
    render(<SessionDialog {...dialogProps(sessionWithJumpHost())} />)
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(`SSH 连接隧道测试失败: ${error instanceof Error ? error.message : error}`)
    expect(screen.getByLabelText('隧道主机')).toHaveValue('bastion.example.com')
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(await screen.findByRole('status')).toHaveTextContent('SSH 连接隧道测试成功')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('prevents duplicate tests and saving while a test is pending', async () => {
    const test = deferredCall()
    services.testJumpHost.mockReturnValue(test.promise)
    const props = dialogProps(sessionWithJumpHost())
    render(<SessionDialog {...props} />)
    const button = screen.getByRole('button', { name: '测试隧道连接' })
    act(() => { fireEvent.click(button); fireEvent.click(button) })
    expect(services.testJumpHost).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '测试中...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: '保存' }).closest('form')!)
    expect(props.onSave).not.toHaveBeenCalled()
    await act(async () => { test.resolve(); await test.promise })
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('aborts a pending test when fields change and ignores stale completion', async () => {
    const test = deferredCall()
    services.testJumpHost.mockReturnValueOnce(test.promise)
    render(<SessionDialog {...dialogProps(sessionWithJumpHost())} />)
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    const signal = test.cancelOn.mock.calls[0][0]
    expect(signal.aborted).toBe(false)
    fireEvent.change(screen.getByLabelText('隧道主机'), { target: { value: 'new-jump' } })
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('button', { name: '测试隧道连接' })).toBeEnabled()
    await act(async () => { test.resolve(); await test.promise })
    expect(screen.queryByText('SSH 连接隧道测试成功')).not.toBeInTheDocument()
    expect(screen.getByLabelText('隧道主机')).toHaveValue('new-jump')
  })

  it('keeps a newer test pending when the cancelled test completes', async () => {
    const first = deferredCall()
    const second = deferredCall()
    services.testJumpHost.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<SessionDialog {...dialogProps(sessionWithJumpHost())} />)
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    fireEvent.change(screen.getByLabelText('隧道主机'), { target: { value: 'new-jump' } })
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    await act(async () => { first.resolve(); await first.promise })
    expect(screen.getByRole('button', { name: '测试中...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await act(async () => { second.reject(new Error('new failure')); await Promise.resolve() })
    expect(await screen.findByRole('alert')).toHaveTextContent('SSH 连接隧道测试失败: new failure')
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('invalidates a successful result when the tested credentials change', async () => {
    render(<SessionDialog {...dialogProps(sessionWithJumpHost())} />)
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(await screen.findByRole('status')).toHaveTextContent('SSH 连接隧道测试成功')
    fireEvent.change(screen.getByLabelText('隧道密码'), { target: { value: 'new-secret' } })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    expect(services.testJumpHost).toHaveBeenLastCalledWith(expect.objectContaining({
      jump_host: expect.objectContaining({ password: 'new-secret' }),
    }))
  })

  it('aborts a pending test when closed and keeps stale rejection out of a reopened dialog', async () => {
    const test = deferredCall()
    services.testJumpHost.mockReturnValueOnce(test.promise)
    const props = dialogProps(sessionWithJumpHost())
    const view = render(<SessionDialog {...props} />)
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(test.cancelOn.mock.calls[0][0].aborted).toBe(true)
    view.rerender(<SessionDialog {...props} open={false} />)
    view.rerender(<SessionDialog {...props} />)
    await act(async () => { test.reject(new Error('old failure')); await Promise.resolve() })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '测试隧道连接' })).toBeEnabled()
  })

  it('aborts and resets the jump form when the edited session changes', async () => {
    const test = deferredCall()
    services.testJumpHost.mockReturnValueOnce(test.promise)
    const props = dialogProps(sessionWithJumpHost())
    const view = render(<SessionDialog {...props} />)
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    view.rerender(<SessionDialog {...props} session={sessionWithJumpHost({ id: '13', jumpHost: undefined })} />)
    expect(test.cancelOn.mock.calls[0][0].aborted).toBe(true)
    expect(screen.getByRole('switch', { name: '启用 SSH 连接隧道' })).not.toBeChecked()
    await act(async () => { test.resolve(); await test.promise })
    expect(screen.queryByText('SSH 连接隧道测试成功')).not.toBeInTheDocument()
  })

  it('aborts the pending Wails call when unmounted', async () => {
    const test = deferredCall()
    services.testJumpHost.mockReturnValueOnce(test.promise)
    const view = render(<SessionDialog {...dialogProps(sessionWithJumpHost())} />)
    await userEvent.click(screen.getByRole('button', { name: '测试隧道连接' }))
    view.unmount()
    expect(test.cancelOn.mock.calls[0][0].aborted).toBe(true)
    await act(async () => { test.resolve(); await test.promise })
  })

  it('locks jump host settings and testing during save', async () => {
    const save = deferredCall()
    const props = dialogProps(sessionWithJumpHost())
    props.onSave = vi.fn(() => save.promise)
    render(<SessionDialog {...props} />)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByLabelText('隧道主机')).toBeDisabled()
    expect(screen.getByRole('switch', { name: '启用 SSH 连接隧道' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getByRole('switch', { name: '启用 SSH 连接隧道' }))
    expect(screen.getByRole('switch', { name: '启用 SSH 连接隧道' })).toBeChecked()
    expect(screen.getByRole('button', { name: '测试隧道连接' })).toBeDisabled()
    await act(async () => { save.resolve(); await save.promise })
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
  })
})
