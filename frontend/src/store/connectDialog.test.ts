import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '@/components/ui/toast'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { useConnectDialog } from '@/store/connectDialog'

const decideHostKey = 'github.com/xuthus5/mssh/internal/service.SessionService.DecideHostKey'
const cancelConnect = 'github.com/xuthus5/mssh/internal/service.SessionService.CancelConnect'

describe('connectDialog', () => {
  beforeEach(() => {
    __clearHandlers()
    useToastStore.setState({ toasts: [] })
    useConnectDialog.setState({
      open: false,
      state: 'idle',
      host: '',
      port: 0,
      user: '',
      error: '',
      fingerprint: '',
      algorithm: '',
      attemptId: '',
      sessionId: '',
      retry: null,
    })
  })

  it('opens, updates, and closes connection state', () => {
    const retry = vi.fn()
    const state = useConnectDialog.getState()
    state.openDialog('example.com', 2222, 'root', retry)
    expect(useConnectDialog.getState()).toMatchObject({
      open: true,
      state: 'connecting',
      host: 'example.com',
      port: 2222,
      user: 'root',
      retry,
    })

    useConnectDialog.getState().setState('awaiting-host-key')
    useConnectDialog.getState().setError('denied')
    useConnectDialog.getState().setAttempt('attempt-1')
    useConnectDialog.getState().setFingerprint('attempt-2', 'SHA256:key', 'ssh-ed25519')
    expect(useConnectDialog.getState()).toMatchObject({
      state: 'awaiting-host-key',
      error: 'denied',
      attemptId: 'attempt-2',
      fingerprint: 'SHA256:key',
      algorithm: 'ssh-ed25519',
    })

    useConnectDialog.getState().closeDialog()
    expect(useConnectDialog.getState()).toMatchObject({
      open: false,
      state: 'idle',
      attemptId: '',
      fingerprint: '',
      algorithm: '',
      retry: null,
    })
  })

  it('closes automatically after reaching connected state', () => {
    useConnectDialog.setState({ open: true, state: 'connecting' })
    useConnectDialog.getState().setState('connected')
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle' })
  })

  it('requires an attempt before accepting a host key', async () => {
    await expect(useConnectDialog.getState().acceptHostKey()).rejects.toThrow('连接尝试尚未就绪')
  })

  it('accepts and rejects host keys through Wails', async () => {
    const decide = vi.fn(async () => {})
    __registerHandler(decideHostKey, decide)
    useConnectDialog.setState({
      open: true,
      state: 'awaiting-host-key',
      attemptId: 'attempt-7',
      fingerprint: 'SHA256:key',
      algorithm: 'ssh-ed25519',
    })

    await useConnectDialog.getState().acceptHostKey()
    expect(decide).toHaveBeenCalledWith('attempt-7', true)
    expect(useConnectDialog.getState()).toMatchObject({ state: 'connecting', fingerprint: '', algorithm: '' })

    useConnectDialog.setState({
      open: true,
      state: 'awaiting-host-key',
      attemptId: 'attempt-8',
      fingerprint: 'SHA256:other',
      algorithm: 'rsa-sha2-512',
    })
    await useConnectDialog.getState().rejectHostKey()
    expect(decide).toHaveBeenLastCalledWith('attempt-8', false)
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle', attemptId: '' })

    await useConnectDialog.getState().rejectHostKey()
    expect(decide).toHaveBeenCalledTimes(2)
  })

  it('cancels active and pending connection attempts', async () => {
    const cancel = vi.fn(async () => {})
    __registerHandler(cancelConnect, cancel)
    useConnectDialog.setState({ open: true, state: 'connecting', attemptId: 'attempt-9' })

    await useConnectDialog.getState().cancelConnection()
    expect(cancel).toHaveBeenCalledWith('attempt-9')
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle', attemptId: '' })

    await useConnectDialog.getState().cancelConnection()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(useConnectDialog.getState().state).toBe('idle')
  })

  it('toasts host key decision failures', async () => {
    __registerHandler(decideHostKey, async () => {
      throw new Error('host key failed')
    })
    useConnectDialog.getState().openDialog('h', 22, 'u', vi.fn())
    useConnectDialog.getState().setAttempt('attempt-err')
    await expect(useConnectDialog.getState().acceptHostKey()).rejects.toThrow('host key failed')
    expect(useConnectDialog.getState()).toMatchObject({ state: 'failed', error: 'host key failed' })
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('host key failed'))).toBe(true)
  })

  it('tracks session id and dismisses only matching connect dialogs', () => {
    const retry = vi.fn()
    useConnectDialog.getState().openDialog('example.com', 22, 'root', retry, '42')
    expect(useConnectDialog.getState()).toMatchObject({ open: true, sessionId: '42', state: 'connecting' })
    useConnectDialog.getState().dismissForSessions(['99'])
    expect(useConnectDialog.getState().open).toBe(true)
    useConnectDialog.getState().dismissForSessions(['42'])
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle', sessionId: '', attemptId: '' })
  })


})
