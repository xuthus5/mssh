import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { setReconnectSessionProvider, startEventBridge } from '@/store/eventBridge'
import { useAppStore } from '@/store/appStore'
import { useConnectDialog } from '@/store/connectDialog'
import { DEFAULT_TERMINAL_BEHAVIOR, useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { shutdownReconnectRuntime } from '@/hooks/sessionReconnect'

const terminalService = 'github.com/xuthus5/mssh/internal/service.TerminalService.'
const fileService = 'github.com/xuthus5/mssh/internal/service.FileService.'
const sessions = [
  { id: '5', host: 'one.internal', port: 22, username: 'root' },
  { id: '6', host: 'two.internal', port: 22, username: 'admin' },
]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('eventBridge reconnect scheduling', () => {
  beforeEach(() => {
    shutdownReconnectRuntime()
    __clearHandlers()
    __registerHandler(fileService + 'ListTransfers', async () => [])
    setReconnectSessionProvider(() => sessions)
    useTerminalBehaviorStore.setState({ ...DEFAULT_TERMINAL_BEHAVIOR, autoReconnect: true })
    useConnectDialog.setState({
      open: false,
      state: 'idle',
      host: '',
      port: 0,
      user: '',
      sessionId: '',
      error: '',
      dialogId: 0,
      cancelRequest: null,
      retry: null,
    })
    useAppStore.setState({
      tabs: [
        { id: 'tab-1', title: 'One', type: 'terminal', terminalId: 'term-1', sessionId: 5 },
        { id: 'tab-2', title: 'Two', type: 'terminal', terminalId: 'term-2', sessionId: 6 },
      ],
      connectionStatus: { 'term-1': 'connected', 'term-2': 'connected' },
      terminalPool: new Map(),
    })
  })

  afterEach(() => {
    setReconnectSessionProvider(null)
    shutdownReconnectRuntime()
  })

  it('preserves FIFO reconnect requests received from backend events', async () => {
    const firstOpen = deferred<string>()
    const open = vi.fn((sessionID: number) => sessionID === 5
      ? firstOpen.promise
      : Promise.resolve('term-2-new'))
    __registerHandler(terminalService + 'Open', open)
    __registerHandler(terminalService + 'Close', vi.fn(async () => {}))
    const stop = startEventBridge()

    __emitEvent('session:state', { data: { terminal_id: 'term-1', state: 'disconnected' } })
    __emitEvent('session:state', { data: { terminal_id: 'term-2', state: 'disconnected' } })
    await waitFor(() => expect(open).toHaveBeenCalledOnce())

    firstOpen.resolve('term-1-new')
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(open).toHaveBeenLastCalledWith(6, 80, 24)

    stop()
  })

  it('removes a queued reconnect when terminal closure removes its tab', async () => {
    const firstOpen = deferred<string>()
    const open = vi.fn((sessionID: number) => sessionID === 5
      ? firstOpen.promise
      : Promise.resolve('term-2-new'))
    __registerHandler(terminalService + 'Open', open)
    __registerHandler(terminalService + 'Close', vi.fn(async () => {}))
    const stop = startEventBridge()

    __emitEvent('session:state', { data: { terminal_id: 'term-1', state: 'disconnected' } })
    __emitEvent('session:state', { data: { terminal_id: 'term-2', state: 'disconnected' } })
    await waitFor(() => expect(open).toHaveBeenCalledOnce())
    __emitEvent('terminal:closed', { data: { terminal_id: 'term-2' } })

    firstOpen.resolve('term-1-new')
    await waitFor(() => expect(useAppStore.getState().tabs).toHaveLength(1))
    await Promise.resolve()
    expect(open).toHaveBeenCalledOnce()

    stop()
  })
})
