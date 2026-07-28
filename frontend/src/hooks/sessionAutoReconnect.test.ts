import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import {
  maybeAutoReconnectTerminal,
  RECONNECT_SPLIT_PANE_EVENT,
  shutdownReconnectRuntime,
  type ReconnectSplitPaneDetail,
} from '@/hooks/sessionReconnect'
import { DEFAULT_TERMINAL_BEHAVIOR, useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { useConnectDialog } from '@/store/connectDialog'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const service = 'github.com/xuthus5/mssh/internal/service.TerminalService.'
const sessions = [
  { id: '5', host: 'one.internal', port: 22, username: 'root' },
  { id: '6', host: 'two.internal', port: 22, username: 'admin' },
]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function seedDisconnectedTabs() {
  useAppStore.setState({
    tabs: [
      { id: 'tab-1', title: 'One', type: 'terminal', terminalId: 'term-1', sessionId: 5 },
      { id: 'tab-2', title: 'Two', type: 'terminal', terminalId: 'term-2', sessionId: 6 },
    ],
    activeSurface: { type: 'terminal', id: 'tab-1' },
    connectionStatus: { 'term-1': 'disconnected', 'term-2': 'disconnected' },
    terminalPool: new Map(),
  })
}

describe('automatic reconnect scheduling', () => {
  beforeEach(() => {
    shutdownReconnectRuntime()
    __clearHandlers()
    seedDisconnectedTabs()
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
    useTerminalBehaviorStore.setState({ ...DEFAULT_TERMINAL_BEHAVIOR, autoReconnect: true })
  })

  afterEach(() => shutdownReconnectRuntime())

  it('serializes simultaneous disconnects instead of dropping the second tab', async () => {
    const firstOpen = deferred<string>()
    const open = vi.fn((sessionID: number) => sessionID === 5
      ? firstOpen.promise
      : Promise.resolve('term-2-new'))
    __registerHandler(service + 'Open', open)
    __registerHandler(service + 'Close', vi.fn(async () => {}))

    maybeAutoReconnectTerminal('term-1', sessions)
    maybeAutoReconnectTerminal('term-2', sessions)

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    expect(open).toHaveBeenLastCalledWith(5, 80, 24)

    firstOpen.resolve('term-1-new')

    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(open).toHaveBeenLastCalledWith(6, 80, 24)
    expect(useAppStore.getState().tabs).toEqual([
      expect.objectContaining({ id: 'tab-1', terminalId: 'term-1-new' }),
      expect.objectContaining({ id: 'tab-2', terminalId: 'term-2-new' }),
    ])
  })

  it('drops queued work when its tab closes before execution', async () => {
    const firstOpen = deferred<string>()
    const open = vi.fn((sessionID: number) => sessionID === 5
      ? firstOpen.promise
      : Promise.resolve('term-2-new'))
    __registerHandler(service + 'Open', open)
    __registerHandler(service + 'Close', vi.fn(async () => {}))

    maybeAutoReconnectTerminal('term-1', sessions)
    maybeAutoReconnectTerminal('term-2', sessions)
    await waitFor(() => expect(open).toHaveBeenCalledOnce())

    useAppStore.getState().removeTabLocal('tab-2')
    firstOpen.resolve('term-1-new')

    await waitFor(() => expect(useAppStore.getState().tabs[0]).toMatchObject({ terminalId: 'term-1-new' }))
    await Promise.resolve()
    expect(open).toHaveBeenCalledOnce()
  })

  it('cancels active and queued reconnects when the setting is disabled', async () => {
    const firstOpen = deferred<string>()
    const open = vi.fn((sessionID: number) => sessionID === 5
      ? firstOpen.promise
      : Promise.resolve('term-2-new'))
    const close = vi.fn(async () => {})
    __registerHandler(service + 'Open', open)
    __registerHandler(service + 'Close', close)

    maybeAutoReconnectTerminal('term-1', sessions)
    maybeAutoReconnectTerminal('term-2', sessions)
    await waitFor(() => expect(open).toHaveBeenCalledOnce())

    useTerminalBehaviorStore.setState({ autoReconnect: false })
    expect(useAppStore.getState().connectionStatus['term-1']).toBe('disconnected')
    firstOpen.resolve('term-1-new')

    await waitFor(() => expect(close).toHaveBeenCalledWith('term-1-new'))
    expect(open).toHaveBeenCalledOnce()
    expect(useAppStore.getState().tabs[0]).toMatchObject({ terminalId: 'term-1' })
  })

  it('keeps blocked reconnects queued until another connection dialog closes', async () => {
    const open = vi.fn(async () => 'term-1-new')
    __registerHandler(service + 'Open', open)
    useConnectDialog.getState().openDialog('busy.internal', 22, 'root', vi.fn(), '99')

    maybeAutoReconnectTerminal('term-1', sessions)
    await Promise.resolve()
    expect(open).not.toHaveBeenCalled()

    useConnectDialog.getState().closeDialog()
    await waitFor(() => expect(open).toHaveBeenCalledOnce())
  })

  it('deduplicates repeated disconnect events for one terminal', async () => {
    const open = deferred<string>()
    const openHandler = vi.fn(async () => open.promise)
    __registerHandler(service + 'Open', openHandler)
    __registerHandler(service + 'Close', vi.fn(async () => {}))

    maybeAutoReconnectTerminal('term-1', sessions)
    maybeAutoReconnectTerminal('term-1', sessions)

    await waitFor(() => expect(openHandler).toHaveBeenCalledOnce())
    open.resolve('term-1-new')
    await waitFor(() => expect(useAppStore.getState().tabs[0]).toMatchObject({ terminalId: 'term-1-new' }))
    expect(openHandler).toHaveBeenCalledOnce()
  })

  it('serializes split-pane and primary reconnect work through one global queue', async () => {
    useAppStore.setState({
      tabs: [
        {
          id: 'tab-split', title: 'Split', type: 'terminal', terminalId: 'term-primary', sessionId: 5,
          splitPaneIDs: ['term-primary', 'term-split'],
        },
        { id: 'tab-2', title: 'Two', type: 'terminal', terminalId: 'term-2', sessionId: 6 },
      ],
      connectionStatus: {
        'term-primary': 'connected',
        'term-split': 'disconnected',
        'term-2': 'disconnected',
      },
    })
    const splitReconnect = deferred<void>()
    const onSplitReconnect = (event: Event) => {
      const detail = (event as CustomEvent<ReconnectSplitPaneDetail>).detail
      detail.accept(() => splitReconnect.promise)
    }
    window.addEventListener(RECONNECT_SPLIT_PANE_EVENT, onSplitReconnect)
    const open = vi.fn(async () => 'term-2-new')
    __registerHandler(service + 'Open', open)

    maybeAutoReconnectTerminal('term-split', sessions)
    maybeAutoReconnectTerminal('term-2', sessions)
    await Promise.resolve()
    expect(open).not.toHaveBeenCalled()

    splitReconnect.resolve()
    await waitFor(() => expect(open).toHaveBeenCalledOnce())
    expect(open).toHaveBeenCalledWith(6, 80, 24)
    window.removeEventListener(RECONNECT_SPLIT_PANE_EVENT, onSplitReconnect)
  })

  it('aborts retries when the user cancels the active connection dialog', async () => {
    const open = deferred<string>()
    const openHandler = vi.fn(async () => open.promise)
    const close = vi.fn(async () => {})
    __registerHandler(service + 'Open', openHandler)
    __registerHandler(service + 'Close', close)
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.CancelConnect', async () => {})

    maybeAutoReconnectTerminal('term-1', sessions)
    await waitFor(() => expect(openHandler).toHaveBeenCalledOnce())
    await useConnectDialog.getState().cancelConnection()
    open.resolve('term-1-new')

    await waitFor(() => expect(close).toHaveBeenCalledWith('term-1-new'))
    expect(openHandler).toHaveBeenCalledOnce()
    expect(useAppStore.getState().connectionStatus['term-1']).toBe('disconnected')
  })

  it('does not auto-restart a completed local shell process', async () => {
    useAppStore.setState({
      tabs: [{ id: 'tab-local', title: 'Local', type: 'terminal', terminalId: 'term-local', sessionId: 0, connectionKind: 'local' }],
      connectionStatus: { 'term-local': 'disconnected' },
    })
    const openLocal = vi.fn(async () => 'term-local-new')
    __registerHandler(service + 'OpenLocal', openLocal)

    maybeAutoReconnectTerminal('term-local', sessions)
    await Promise.resolve()

    expect(openLocal).not.toHaveBeenCalled()
  })
})
