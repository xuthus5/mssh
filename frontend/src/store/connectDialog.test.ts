import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectDialog } from '@/store/connectDialog'

describe('connectDialog', () => {
  beforeEach(() => {
    useConnectDialog.setState({
      open: false,
      state: 'idle',
      host: '',
      port: 0,
      user: '',
      error: '',
      sessionId: '',
      dialogId: 0,
      cancelRequest: null,
      retry: null,
    })
  })

  it('opens and closes a connection owned by a dialog id', () => {
    const retry = vi.fn()
    const dialogId = useConnectDialog.getState().openDialog('example.com', 2222, 'root', retry, '42')

    expect(useConnectDialog.getState()).toMatchObject({
      open: true,
      state: 'connecting',
      host: 'example.com',
      port: 2222,
      user: 'root',
      retry,
      sessionId: '42',
      dialogId,
    })

    useConnectDialog.getState().closeDialog(dialogId)
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle', retry: null, sessionId: '' })
  })

  it('closes automatically after the owned request completes', () => {
    const dialogId = useConnectDialog.getState().openDialog('example.com', 22, 'root', vi.fn())
    useConnectDialog.getState().completeDialog(dialogId)
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle' })
  })

  it('uses local Wails cancellation and closes the dialog', async () => {
    const cancelRequest = vi.fn()
    const dialogId = useConnectDialog.getState().openDialog('example.com', 22, 'root', vi.fn(), '9')
    useConnectDialog.getState().setCancelHandler(dialogId, cancelRequest)

    await useConnectDialog.getState().cancelConnection()

    expect(cancelRequest).toHaveBeenCalledOnce()
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle' })
  })

  it('surfaces local cancellation failures in the owned dialog', async () => {
    const dialogId = useConnectDialog.getState().openDialog('example.com', 22, 'root', vi.fn())
    useConnectDialog.getState().setCancelHandler(dialogId, () => { throw new Error('cancel boom') })

    await expect(useConnectDialog.getState().cancelConnection()).rejects.toThrow('cancel boom')
    expect(useConnectDialog.getState()).toMatchObject({ open: true, state: 'failed', error: 'cancel boom' })
  })

  it('ignores stale completion, failure, cancellation handler, and close calls', () => {
    const firstId = useConnectDialog.getState().openDialog('first.internal', 22, 'root', vi.fn(), '1')
    const secondId = useConnectDialog.getState().openDialog('second.internal', 22, 'root', vi.fn(), '2')
    const staleCancel = vi.fn()

    useConnectDialog.getState().setCancelHandler(firstId, staleCancel)
    useConnectDialog.getState().completeDialog(firstId)
    useConnectDialog.getState().failDialog(firstId, 'stale failure')
    useConnectDialog.getState().closeDialog(firstId)

    expect(useConnectDialog.getState()).toMatchObject({
      open: true,
      dialogId: secondId,
      host: 'second.internal',
      state: 'connecting',
      error: '',
      cancelRequest: null,
    })
  })

  it('dismisses only dialogs that belong to deleted sessions', () => {
    useConnectDialog.getState().openDialog('example.com', 22, 'root', vi.fn(), '42')
    useConnectDialog.getState().dismissForSessions(['99'])
    expect(useConnectDialog.getState().open).toBe(true)

    useConnectDialog.getState().dismissForSessions(['42'])
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle', sessionId: '' })
  })
})
