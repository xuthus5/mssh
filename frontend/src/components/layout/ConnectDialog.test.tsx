import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectDialog } from '@/components/layout/ConnectDialog'
import { useToastStore } from '@/components/ui/toast'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { useConnectDialog } from '@/store/connectDialog'

const decideHostKey = 'github.com/xuthus5/mssh/internal/service.SessionService.DecideHostKey'
const cancelConnect = 'github.com/xuthus5/mssh/internal/service.SessionService.CancelConnect'

describe('ConnectDialog', () => {
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
      retry: null,
    })
  })

  it('swallows host key accept rejections after toasting', async () => {
    __registerHandler(decideHostKey, async () => { throw new Error('host key boom') })
    useConnectDialog.setState({
      open: true,
      state: 'awaiting-host-key',
      host: 'example.com',
      port: 22,
      user: 'root',
      fingerprint: 'SHA256:abc',
      algorithm: 'ssh-ed25519',
      attemptId: 'attempt-1',
    })
    render(<ConnectDialog />)
    await userEvent.click(screen.getByRole('button', { name: '信任并连接' }))
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('host key boom') && item.type === 'error')).toBe(true))
    expect(useConnectDialog.getState().state).toBe('failed')
  })

  it('swallows cancel connection rejections after toasting', async () => {
    __registerHandler(cancelConnect, async () => { throw new Error('cancel boom') })
    useConnectDialog.setState({
      open: true,
      state: 'connecting',
      host: 'example.com',
      port: 22,
      user: 'root',
      attemptId: 'attempt-2',
    })
    render(<ConnectDialog />)
    await userEvent.click(screen.getByRole('button', { name: '取消连接' }))
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('cancel boom') && item.type === 'error')).toBe(true))
    expect(useConnectDialog.getState().state).toBe('failed')
  })

  it('swallows host key reject rejections after toasting', async () => {
    __registerHandler(decideHostKey, async () => { throw new Error('reject boom') })
    useConnectDialog.setState({
      open: true,
      state: 'awaiting-host-key',
      host: 'example.com',
      port: 22,
      user: 'root',
      fingerprint: 'SHA256:abc',
      algorithm: 'ssh-ed25519',
      attemptId: 'attempt-3',
    })
    render(<ConnectDialog />)
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('reject boom') && item.type === 'error')).toBe(true))
    expect(useConnectDialog.getState().state).toBe('failed')
  })
})
