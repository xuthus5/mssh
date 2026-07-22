import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markIntentionalDisconnect, maybeAutoReconnectTerminal, reconnectSessionTab } from '@/hooks/sessionReconnect'
import { DEFAULT_TERMINAL_BEHAVIOR, useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { logger } from '@/lib/logger'
import { useConnectDialog } from '@/store/connectDialog'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const service = 'github.com/xuthus5/mssh/internal/service.TerminalService.'
const sessions = [{ id: '5', host: 'server.internal', port: 22, username: 'root' }]
const replaceTerminalConnection = useAppStore.getState().replaceTerminalConnection

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function seedDisconnectedTab() {
  useAppStore.setState({
    tabs: [{ id: 'tab-1', title: 'Server', type: 'terminal', terminalId: 'term-old', sessionId: 5 }],
    activeSurface: { type: 'terminal', id: 'tab-1' },
    connectionStatus: { 'term-old': 'disconnected' },
    terminalPool: new Map(),
  })
}

describe('reconnectSessionTab', () => {
  beforeEach(() => {
    __clearHandlers()
    seedDisconnectedTab()
    useAppStore.setState({ replaceTerminalConnection })
    useConnectDialog.setState({ open: false, state: 'idle', attemptId: '', error: '', fingerprint: '', algorithm: '' })
    useTerminalBehaviorStore.setState({ ...DEFAULT_TERMINAL_BEHAVIOR, autoReconnect: false })
  })

  it('ignores missing and already connecting terminal targets', async () => {
    const open = vi.fn(async () => 'term-new')
    __registerHandler(service + 'Open', open)

    await reconnectSessionTab('missing', sessions)
    useAppStore.getState().setConnectionStatus('term-old', 'connecting')
    await reconnectSessionTab('tab-1', sessions)

    expect(open).not.toHaveBeenCalled()
  })

  it('does not replace another active connection dialog', async () => {
    const open = vi.fn(async () => 'term-new')
    __registerHandler(service + 'Open', open)
    useConnectDialog.getState().openDialog('other.internal', 22, 'admin', vi.fn())

    await reconnectSessionTab('tab-1', sessions)

    expect(open).not.toHaveBeenCalled()
    expect(useConnectDialog.getState()).toMatchObject({ host: 'other.internal', state: 'connecting' })
  })

  it('closes a newly opened terminal when its tab disappears', async () => {
    const open = deferred<string>()
    const close = vi.fn(async () => {})
    __registerHandler(service + 'Open', async () => open.promise)
    __registerHandler(service + 'Close', close)

    const reconnecting = reconnectSessionTab('tab-1', sessions)
    useAppStore.getState().removeTabLocal('tab-1')
    open.resolve('term-new')
    await reconnecting

    expect(close).toHaveBeenCalledWith('term-new')
    expect(useAppStore.getState().tabs).toHaveLength(0)
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle' })
  })

  it('closes the connection dialog when a pending reconnect fails after tab removal', async () => {
    const open = deferred<string>()
    __registerHandler(service + 'Open', async () => open.promise)
    const reconnecting = reconnectSessionTab('tab-1', sessions)
    useAppStore.getState().removeTabLocal('tab-1')

    open.reject(new Error('network failed'))
    await reconnecting

    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle' })
    expect(useAppStore.getState().connectionStatus['term-old']).toBeUndefined()
  })

  it('logs cleanup failures when a reconnect replacement becomes stale', async () => {
    const error = new Error('close failed')
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    __registerHandler(service + 'Open', async () => 'term-new')
    __registerHandler(service + 'Close', async () => { throw error })
    useAppStore.getState().removeTabLocal('tab-1')
    seedDisconnectedTab()
    useAppStore.setState({ replaceTerminalConnection: () => false })

    await reconnectSessionTab('tab-1', sessions)

    expect(loggerError).toHaveBeenCalledWith('reconnect stale terminal cleanup failed', error)
  })

  it('retries with backoff and exposes the final error', async () => {
    vi.useFakeTimers()
    const open = vi.fn(async () => { throw new Error('network failed') })
    __registerHandler(service + 'Open', open)

    const reconnecting = reconnectSessionTab('tab-1', sessions)
    await vi.runAllTimersAsync()
    await reconnecting

    expect(open).toHaveBeenCalledTimes(3)
    expect(useAppStore.getState().connectionStatus['term-old']).toBe('error')
    expect(useConnectDialog.getState().error).toContain('network failed')
    vi.useRealTimers()
  })

  it('cancels an in-flight reconnect from a second request', async () => {
    const open = deferred<string>()
    __registerHandler(service + 'Open', async () => open.promise)
    const first = reconnectSessionTab('tab-1', sessions)
    await reconnectSessionTab('tab-1', sessions)
    open.reject(new Error('cancelled'))
    await first
    expect(useAppStore.getState().connectionStatus['term-old']).toBe('disconnected')
  })

  it('reconnects local shell tabs via OpenLocal without host dialog', async () => {
    useAppStore.setState({
      tabs: [{ id: 'tab-local', title: '本地终端', type: 'terminal', terminalId: 'term-local-old', sessionId: 0, connectionKind: 'local' }],
      activeSurface: { type: 'terminal', id: 'tab-local' },
      connectionStatus: { 'term-local-old': 'disconnected' },
      terminalPool: new Map(),
    })
    const openLocal = vi.fn(async () => 'term-local-new')
    __registerHandler(service + 'OpenLocal', openLocal)
    __registerHandler(service + 'Open', vi.fn(async () => 'should-not-open'))
    __registerHandler(service + 'Close', vi.fn(async () => {}))
    await reconnectSessionTab('tab-local', sessions)
    expect(openLocal).toHaveBeenCalled()
    expect(useConnectDialog.getState().open).toBe(false)
    const tab = useAppStore.getState().tabs.find((item) => item.id === 'tab-local')
    expect(tab).toMatchObject({ terminalId: 'term-local-new', connectionKind: 'local' })
    expect(useAppStore.getState().connectionStatus['term-local-new']).toBe('connected')
  })
})

describe('maybeAutoReconnectTerminal', () => {
  beforeEach(() => {
    __clearHandlers()
    seedDisconnectedTab()
    useAppStore.setState({ replaceTerminalConnection })
    useConnectDialog.setState({ open: false, state: 'idle', attemptId: '', error: '', fingerprint: '', algorithm: '' })
    useTerminalBehaviorStore.setState({ ...DEFAULT_TERMINAL_BEHAVIOR, autoReconnect: false })
  })

  it('does nothing when auto reconnect is disabled', async () => {
    const open = vi.fn(async () => 'term-new')
    __registerHandler(service + 'Open', open)
    maybeAutoReconnectTerminal('term-old', sessions)
    await Promise.resolve()
    expect(open).not.toHaveBeenCalled()
  })

  it('starts reconnect when auto reconnect is enabled', async () => {
    useTerminalBehaviorStore.setState({ autoReconnect: true, renderer: 'dom', historyPredict: false })
    const open = deferred<string>()
    __registerHandler(service + 'Open', async () => open.promise)
    maybeAutoReconnectTerminal('term-old', sessions)
    await Promise.resolve()
    expect(useAppStore.getState().connectionStatus['term-old']).toBe('reconnecting')
    open.resolve('term-new')
  })

  it('skips auto reconnect for intentional disconnects', async () => {
    useTerminalBehaviorStore.setState({ autoReconnect: true, renderer: 'dom', historyPredict: false })
    const open = vi.fn(async () => 'term-new')
    __registerHandler(service + 'Open', open)
    markIntentionalDisconnect('term-old')
    maybeAutoReconnectTerminal('term-old', sessions)
    await Promise.resolve()
    expect(open).not.toHaveBeenCalled()
  })

  it('does not auto-reconnect serial terminals', async () => {
    useTerminalBehaviorStore.setState({ autoReconnect: true, renderer: 'dom', historyPredict: false })
    useAppStore.setState({
      tabs: [{ id: 'tab-serial', title: 'UART', type: 'terminal', terminalId: 'term-serial', sessionId: 0, connectionKind: 'serial', serialPortId: 9 }],
      connectionStatus: { 'term-serial': 'disconnected' },
    })
    const openSerial = vi.fn(async () => 'term-serial-new')
    __registerHandler(service + 'OpenSerial', openSerial)
    maybeAutoReconnectTerminal('term-serial', [])
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(openSerial).not.toHaveBeenCalled()
  })
})
