import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectSession, type SessionConnectionOptions } from '@/hooks/sessionConnectionActionHooks'
import { openSessionTab } from '@/hooks/sessionTabLifecycle'
import { useConnectDialog } from '@/store/connectDialog'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import type { Session } from '@/lib/sessionModels'

const service = 'github.com/xuthus5/mssh/internal/service.TerminalService.'
const jumpHost = { host: 'bastion.internal', port: 2222, username: 'deploy', authMethod: 'agent' as const }
const session: Session = {
  id: '5', name: 'Internal', host: 'target.internal', port: 22, username: 'root', authMethod: 'agent',
  keepAlive: 0, termType: 'xterm-256color', folderId: null, jumpHost,
}

function options(target = session): SessionConnectionOptions {
  return {
    sessions: [target], setSessions: vi.fn(), setRecentSessions: vi.fn(),
    listSessions: vi.fn(async () => undefined), listRecentSessions: vi.fn(async () => undefined),
    refreshAssets: vi.fn(async () => undefined),
  }
}

function deferredOpen() {
  let resolve!: (id: string) => void
  const promise = new Promise<string>((accept) => { resolve = accept })
  return { promise, resolve }
}

beforeEach(() => {
  __clearHandlers()
  useConnectDialog.setState(useConnectDialog.getInitialState())
  useAppStore.setState({
    tabs: [], activeSurface: null, activePaneId: null, terminalPool: new Map(), maxPoolSize: 6,
    connectionStatus: {}, pendingTerminalOpens: 0, terminalOpenReservations: new Set(),
  })
})

afterEach(() => { vi.restoreAllMocks() })

describe('foreground SSH jump progress requests', () => {
  it('opens a jump terminal with the exact dialog request identifier', async () => {
    const directOpen = vi.fn(async () => 'unexpected-direct')
    const progressOpen = vi.fn(async (input: { request_id: string }) => {
      expect(useConnectDialog.getState()).toMatchObject({ requestId: input.request_id, stage: 'jump',
        jumpHost: { host: jumpHost.host, port: jumpHost.port, username: jumpHost.username } })
      return 'term-jump'
    })
    __registerHandler(service + 'Open', directOpen)
    __registerHandler(service + 'OpenWithProgress', progressOpen)
    const config = options()
    const { result } = renderHook(() => useConnectSession(config))
    await act(async () => result.current('5'))
    expect(progressOpen).toHaveBeenCalledWith({ session_id: 5, cols: 80, rows: 24, request_id: expect.any(String) })
    expect(directOpen).not.toHaveBeenCalled()
    expect(useConnectDialog.getState()).toMatchObject({ state: 'connected', open: true })
    expect(useAppStore.getState().tabs[0]).toMatchObject({ terminalId: 'term-jump', sessionId: 5 })
  })

  it('keeps a direct connection on the existing Open API', async () => {
    const directOpen = vi.fn(async () => 'term-direct')
    const progressOpen = vi.fn(async () => 'unexpected-jump')
    __registerHandler(service + 'Open', directOpen)
    __registerHandler(service + 'OpenWithProgress', progressOpen)
    const config = options({ ...session, jumpHost: undefined })
    const { result } = renderHook(() => useConnectSession(config))
    await act(async () => result.current('5'))
    expect(directOpen).toHaveBeenCalledWith(5, 80, 24)
    expect(progressOpen).not.toHaveBeenCalled()
    expect(useConnectDialog.getState()).toMatchObject({ jumpHost: null, requestId: '', stage: 'target' })
  })

  it('uses a new identifier for a manual retry and retires the failed request', async () => {
    const progressOpen = vi.fn().mockRejectedValueOnce(new Error('jump login failed')).mockResolvedValueOnce('term-retry')
    __registerHandler(service + 'OpenWithProgress', progressOpen)
    const config = options()
    const { result } = renderHook(() => useConnectSession(config))
    await act(async () => result.current('5'))
    const previous = useConnectDialog.getState()
    expect(previous.state).toBe('failed')
    act(() => { previous.closeDialog(); previous.retry?.() })
    await waitFor(() => expect(useConnectDialog.getState().state).toBe('connected'))
    const requestIds = progressOpen.mock.calls.map(([input]) => input.request_id)
    expect(new Set(requestIds).size).toBe(2)
    expect(useConnectDialog.getState().isRetiredRequest(previous.requestId)).toBe(true)
  })

  it('closes a jump terminal that arrives after the user cancels its request', async () => {
    const pending = deferredOpen()
    const progressOpen = vi.fn(() => pending.promise)
    const close = vi.fn(async () => undefined)
    __registerHandler(service + 'OpenWithProgress', progressOpen)
    __registerHandler(service + 'Close', close)
    const config = options()
    const { result } = renderHook(() => useConnectSession(config))
    let operation!: Promise<void>
    act(() => { operation = result.current('5') })
    await waitFor(() => expect(progressOpen).toHaveBeenCalledOnce())
    const requestId = useConnectDialog.getState().requestId
    await act(async () => useConnectDialog.getState().cancelConnection())
    await act(async () => { pending.resolve('term-cancelled'); await operation })
    expect(close).toHaveBeenCalledWith('term-cancelled')
    expect(useAppStore.getState().tabs).toHaveLength(0)
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle' })
    expect(useConnectDialog.getState().isRetiredRequest(requestId)).toBe(true)
  })

  it('uses progress only when the session has a jump host and a request was provided', async () => {
    const directOpen = vi.fn(async () => 'term-direct')
    const progressOpen = vi.fn(async () => 'term-jump')
    __registerHandler(service + 'Open', directOpen)
    __registerHandler(service + 'OpenWithProgress', progressOpen)
    await openSessionTab({ ...session, jumpHost: undefined }, undefined, 'unneeded-request')
    await openSessionTab(session)
    expect(directOpen).toHaveBeenCalledTimes(2)
    expect(progressOpen).not.toHaveBeenCalled()
    await openSessionTab(session, undefined, 'jump-request')
    expect(progressOpen).toHaveBeenCalledWith({ session_id: 5, cols: 80, rows: 24, request_id: 'jump-request' })
  })
})
