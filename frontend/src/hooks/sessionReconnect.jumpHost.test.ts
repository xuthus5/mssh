import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reconnectSessionTab, shutdownReconnectRuntime } from '@/hooks/sessionReconnect'
import { cancelRunningReconnectForTab, performReconnectSessionTab, RECONNECT_ATTEMPT_TIMEOUT_MS } from '@/hooks/sessionReconnectRunner'
import { useConnectDialog } from '@/store/connectDialog'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'
import { useAppStore } from '@/store/appStore'
import { startEventBridge } from '@/store/eventBridge'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'

const service = 'github.com/xuthus5/mssh/internal/service.TerminalService.'
const sessionService = 'github.com/xuthus5/mssh/internal/service.SessionService.'
const jumpHost = { host: 'bastion.internal', port: 2222, username: 'deploy', authMethod: 'agent' as const }
const sessions = [{ id: '5', host: 'target.internal', port: 22, username: 'root', jumpHost }]
interface OpenRequest { session_id: number; request_id: string; cols: number; rows: number }
let stopBridge: (() => void) | undefined

function deferredOpen() {
  let resolve!: (id: string) => void
  const promise = new Promise<string>((accept) => { resolve = accept })
  return { promise, resolve }
}

function fingerprint(requestId: string, stage: 'jump' | 'target') {
  __emitEvent('session:fingerprint', { data: {
    request_id: requestId, attempt_id: `${requestId}-${stage}`, is_jump_host: stage === 'jump',
    hostname: `${stage}.internal:22`, fingerprint: `SHA256:${stage}`, algorithm: 'ssh-ed25519',
  } })
}

beforeEach(() => {
  __clearHandlers()
  shutdownReconnectRuntime()
  useConnectDialog.setState(useConnectDialog.getInitialState())
  useHostKeyPromptDialog.setState(useHostKeyPromptDialog.getInitialState())
  useAppStore.setState({
    tabs: [{ id: 'tab-1', title: 'Internal', type: 'terminal', terminalId: 'term-old', sessionId: 5 }],
    activeSurface: { type: 'terminal', id: 'tab-1' }, activePaneId: null,
    connectionStatus: { 'term-old': 'disconnected' }, maxPoolSize: 6,
    terminalPool: new Map(), pendingTerminalOpens: 0, terminalOpenReservations: new Set(),
  })
  __registerHandler(sessionService + 'DecideHostKey', vi.fn(async () => undefined))
  __registerHandler(sessionService + 'CancelConnect', vi.fn(async () => undefined))
  __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListTransfers', async () => [])
  stopBridge = startEventBridge()
})

afterEach(() => { stopBridge?.(); shutdownReconnectRuntime(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('SSH jump reconnect progress', () => {
  it('keeps terminal dimensions and associates a manual reconnect with its dialog request', async () => {
    useAppStore.setState({ terminalPool: new Map([['term-old', { terminal: { cols: 100, rows: 30 } as never, lastUsed: 1 }]]) })
    const open = vi.fn(async (input: OpenRequest) => {
      expect(useConnectDialog.getState()).toMatchObject({ requestId: input.request_id, stage: 'jump' })
      return 'term-new'
    })
    __registerHandler(service + 'OpenWithProgress', open)
    await reconnectSessionTab('tab-1', sessions)
    expect(open).toHaveBeenCalledWith({ session_id: 5, cols: 100, rows: 30, request_id: expect.any(String) })
    expect(useConnectDialog.getState()).toMatchObject({ state: 'connected', open: true })
    expect(useAppStore.getState().tabs[0]).toMatchObject({ terminalId: 'term-new' })
  })

  it('starts every retry at the jump step with a new identifier and ignores prior progress', async () => {
    vi.useFakeTimers()
    const requestIds: string[] = []
    const open = vi.fn(async (input: OpenRequest) => {
      requestIds.push(input.request_id)
      expect(useConnectDialog.getState()).toMatchObject({ requestId: input.request_id, stage: 'jump', attemptId: '' })
      __emitEvent('session:progress', { data: { request_id: requestIds[0], attempt_id: 'old-target', stage: 'target' } })
      if (requestIds.length > 1) expect(useConnectDialog.getState().stage).toBe('jump')
      throw new Error('jump unavailable')
    })
    __registerHandler(service + 'OpenWithProgress', open)
    const reconnecting = reconnectSessionTab('tab-1', sessions)
    await vi.runAllTimersAsync()
    await reconnecting
    expect(new Set(requestIds).size).toBe(3)
    expect(useConnectDialog.getState().isRetiredRequest(requestIds[0])).toBe(true)
    expect(useConnectDialog.getState().isRetiredRequest(requestIds[1])).toBe(true)
    expect(useConnectDialog.getState()).toMatchObject({ state: 'failed', stage: 'jump', error: 'jump unavailable' })
  })

  it('keeps a background jump reconnect separate from a newer foreground connection', async () => {
    const pending = deferredOpen()
    let backgroundRequest = ''
    __registerHandler(service + 'OpenWithProgress', async (input: OpenRequest) => { backgroundRequest = input.request_id; return pending.promise })
    useAppStore.setState({ activeSurface: null })
    const reconnecting = performReconnectSessionTab('tab-1', sessions, 'auto')
    await waitFor(() => expect(backgroundRequest).toBeTruthy())
    expect(useConnectDialog.getState().open).toBe(false)
    const dialogId = useConnectDialog.getState().openDialog('foreground.internal', 22, 'admin', vi.fn(), '6')
    const requestId = useConnectDialog.getState().beginConnectionAttempt(dialogId, jumpHost)
    __emitEvent('session:progress', { data: { request_id: backgroundRequest, attempt_id: 'background-target', stage: 'target' } })
    fingerprint(backgroundRequest, 'jump')
    expect(useHostKeyPromptDialog.getState().active?.prompt).toMatchObject({ requestId: backgroundRequest, isJumpHost: true })
    expect(useConnectDialog.getState()).toMatchObject({ requestId, stage: 'jump', attemptId: '' })
    await useHostKeyPromptDialog.getState().decide(true)
    pending.resolve('term-background')
    await reconnecting
    expect(useConnectDialog.getState()).toMatchObject({ dialogId, state: 'connecting', requestId })
    expect(useAppStore.getState().tabs[0]).toMatchObject({ terminalId: 'term-background' })
  })

  it('retires a cancelled background request without touching another foreground dialog', async () => {
    const pending = deferredOpen()
    const decide = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    let backgroundRequest = ''
    __registerHandler(service + 'OpenWithProgress', async (input: OpenRequest) => { backgroundRequest = input.request_id; return pending.promise })
    __registerHandler(service + 'Close', close)
    __registerHandler(sessionService + 'DecideHostKey', decide)
    useAppStore.setState({ activeSurface: null })
    const reconnecting = performReconnectSessionTab('tab-1', sessions, 'auto')
    await waitFor(() => expect(backgroundRequest).toBeTruthy())
    fingerprint(backgroundRequest, 'jump')
    const dialogId = useConnectDialog.getState().openDialog('foreground.internal', 22, 'admin', vi.fn(), '6')
    const requestId = useConnectDialog.getState().beginConnectionAttempt(dialogId, jumpHost)
    expect(cancelRunningReconnectForTab('tab-1')).toBe(true)
    expect(useConnectDialog.getState().isRetiredRequest(backgroundRequest)).toBe(true)
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    fingerprint(backgroundRequest, 'target')
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    expect(decide).toHaveBeenCalledWith(`${backgroundRequest}-jump`, false)
    expect(decide).toHaveBeenCalledWith(`${backgroundRequest}-target`, false)
    pending.resolve('term-cancelled')
    await reconnecting
    expect(close).toHaveBeenCalledWith('term-cancelled')
    expect(useConnectDialog.getState()).toMatchObject({ dialogId, requestId, state: 'connecting' })
  })

  it('retires a previous background retry before accepting the next attempt fingerprint', async () => {
    vi.useFakeTimers()
    const pending = deferredOpen()
    const requests: string[] = []
    __registerHandler(service + 'OpenWithProgress', async (input: OpenRequest) => {
      requests.push(input.request_id)
      if (requests.length === 1) throw new Error('jump handshake failed')
      return pending.promise
    })
    useAppStore.setState({ activeSurface: null })
    const reconnecting = performReconnectSessionTab('tab-1', sessions, 'auto')
    await vi.advanceTimersByTimeAsync(501)
    expect(requests).toHaveLength(2)
    expect(requests[0]).not.toBe(requests[1])
    expect(useConnectDialog.getState().isRetiredRequest(requests[0])).toBe(true)
    fingerprint(requests[0], 'target')
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    fingerprint(requests[1], 'jump')
    expect(useHostKeyPromptDialog.getState().active?.prompt.requestId).toBe(requests[1])
    await useHostKeyPromptDialog.getState().decide(true)
    pending.resolve('term-retried')
    await reconnecting
    expect(useConnectDialog.getState().open).toBe(false)
    expect(useAppStore.getState().tabs[0]).toMatchObject({ terminalId: 'term-retried' })
  })

  it('does not retry after either host key is rejected', async () => {
    vi.useFakeTimers()
    const open = vi.fn(async () => { throw new Error('open terminal: SSH jump host: host key rejected by user') })
    __registerHandler(service + 'OpenWithProgress', open)
    const reconnecting = reconnectSessionTab('tab-1', sessions)
    await vi.runAllTimersAsync()
    await reconnecting
    expect(open).toHaveBeenCalledOnce()
    expect(useConnectDialog.getState()).toMatchObject({ state: 'failed', stage: 'jump' })
  })

  it('pauses the reconnect timeout for both jump and target fingerprint decisions', async () => {
    vi.useFakeTimers()
    const pending = deferredOpen()
    const open = vi.fn(() => pending.promise)
    __registerHandler(service + 'OpenWithProgress', open)
    const reconnecting = reconnectSessionTab('tab-1', sessions)
    await vi.advanceTimersByTimeAsync(100)
    const requestId = useConnectDialog.getState().requestId
    fingerprint(requestId, 'jump')
    await vi.advanceTimersByTimeAsync(RECONNECT_ATTEMPT_TIMEOUT_MS + 1000)
    expect(open).toHaveBeenCalledOnce()
    await useHostKeyPromptDialog.getState().decide(true)
    fingerprint(requestId, 'target')
    await vi.advanceTimersByTimeAsync(RECONNECT_ATTEMPT_TIMEOUT_MS + 1000)
    expect(open).toHaveBeenCalledOnce()
    await useHostKeyPromptDialog.getState().decide(true)
    pending.resolve('term-new')
    await reconnecting
    expect(useConnectDialog.getState()).toMatchObject({ state: 'connected', stage: 'target' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
