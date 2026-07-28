import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConnectDialog } from '@/components/layout/ConnectDialog'
import { useToastStore } from '@/components/ui/toast'
import { useConnectDialog } from '@/store/connectDialog'

describe('ConnectDialog', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
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

  it('cancels the owned connection without using a global backend attempt', async () => {
    let cancelled = false
    const dialogId = useConnectDialog.getState().openDialog('example.com', 22, 'root', () => {})
    useConnectDialog.getState().setCancelHandler(dialogId, () => { cancelled = true })
    render(<ConnectDialog />)

    await userEvent.click(screen.getByRole('button', { name: '取消连接' }))

    expect(cancelled).toBe(true)
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle' })
  })

  it('surfaces cancellation failures in the dialog without toast', async () => {
    const dialogId = useConnectDialog.getState().openDialog('example.com', 22, 'root', () => {})
    useConnectDialog.getState().setCancelHandler(dialogId, () => { throw new Error('cancel boom') })
    render(<ConnectDialog />)

    await userEvent.click(screen.getByRole('button', { name: '取消连接' }))

    await waitFor(() => expect(useConnectDialog.getState()).toMatchObject({ state: 'failed', error: 'cancel boom' }))
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(await screen.findByText('连接失败')).toBeInTheDocument()
    expect(screen.getByText('cancel boom')).toBeInTheDocument()
  })
})
