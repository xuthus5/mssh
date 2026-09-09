import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { reconnectSessionTab, shutdownReconnectRuntime } from '@/hooks/sessionReconnect'
import { RECONNECT_ATTEMPT_TIMEOUT_MS } from '@/hooks/sessionReconnectRunner'
import { useAppStore } from '@/store/appStore'
import { useConnectDialog } from '@/store/connectDialog'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const service = 'github.com/xuthus5/mssh/internal/service.TerminalService.'
const sessions = [{ id: '5', host: 'server.internal', port: 22, username: 'root' }]

function waitForFingerprint() {
  useHostKeyPromptDialog.getState().present({
    coordinatorId: 1,
    prompt: { attemptId: 'attempt-1', hostname: 'server.internal:22', fingerprint: 'SHA256:key', algorithm: 'ssh-ed25519', changed: false, expected: [] },
    endpoint: { host: 'server.internal', port: 22 },
    decide: async () => {},
    dismiss: async () => {},
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  __clearHandlers()
  shutdownReconnectRuntime()
  useConnectDialog.setState(useConnectDialog.getInitialState())
  useHostKeyPromptDialog.setState(useHostKeyPromptDialog.getInitialState())
  useAppStore.setState({
    tabs: [{ id: 'tab-1', title: 'Server', type: 'terminal', terminalId: 'term-old', sessionId: 5 }],
    activeSurface: { type: 'terminal', id: 'tab-1' },
    connectionStatus: { 'term-old': 'disconnected' },
    terminalPool: new Map(), pendingTerminalOpens: 0, terminalOpenReservations: new Set(),
  })
})

afterEach(() => {
  shutdownReconnectRuntime()
  useHostKeyPromptDialog.setState(useHostKeyPromptDialog.getInitialState())
  vi.useRealTimers()
})

describe('SSH reconnect fingerprint wait', () => {
  it.each([false, true])('excludes fingerprint waiting from the timeout (already prompting: %s)', async (alreadyPrompting) => {
    let resolveOpen!: (terminalId: string) => void
    const open = vi.fn(() => new Promise<string>((resolve) => { resolveOpen = resolve }))
    __registerHandler(service + 'Open', open)
    if (alreadyPrompting) waitForFingerprint()
    const reconnecting = reconnectSessionTab('tab-1', sessions)
    await vi.advanceTimersByTimeAsync(5000)
    if (!alreadyPrompting) waitForFingerprint()
    await vi.advanceTimersByTimeAsync(RECONNECT_ATTEMPT_TIMEOUT_MS + 1000)
    expect(open).toHaveBeenCalledOnce()
    expect(useAppStore.getState().connectionStatus['term-old']).toBe('reconnecting')
    await useHostKeyPromptDialog.getState().decide(true)
    resolveOpen('term-new')
    await reconnecting
    expect(useConnectDialog.getState()).toMatchObject({ open: true, state: 'connected' })
    expect(useAppStore.getState().tabs[0]).toMatchObject({ terminalId: 'term-new' })
    expect(vi.getTimerCount()).toBe(0)
    waitForFingerprint()
    await useHostKeyPromptDialog.getState().decide(false)
    await vi.advanceTimersByTimeAsync(RECONNECT_ATTEMPT_TIMEOUT_MS)
    expect(vi.getTimerCount()).toBe(0)
    expect(open).toHaveBeenCalledOnce()
  })

  it('resumes the remaining timeout and still fails a stalled connection', async () => {
    const open = vi.fn(() => new Promise<string>(() => {}))
    __registerHandler(service + 'Open', open)
    const reconnecting = reconnectSessionTab('tab-1', sessions)
    await vi.advanceTimersByTimeAsync(5000)
    waitForFingerprint()
    await vi.advanceTimersByTimeAsync(RECONNECT_ATTEMPT_TIMEOUT_MS * 2)
    await useHostKeyPromptDialog.getState().decide(true)
    await vi.advanceTimersByTimeAsync(RECONNECT_ATTEMPT_TIMEOUT_MS - 5001)
    expect(open).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(RECONNECT_ATTEMPT_TIMEOUT_MS * 3)
    await reconnecting
    expect(open).toHaveBeenCalledTimes(3)
    expect(useConnectDialog.getState().error).toContain('timed out')
  })

  it('keeps local reconnect timeouts independent of SSH fingerprint prompts', async () => {
    useAppStore.setState({ tabs: [{ id: 'tab-1', title: 'Local', type: 'terminal', connectionKind: 'local', terminalId: 'term-old', sessionId: 0 }] })
    const open = vi.fn(() => new Promise<string>(() => {}))
    __registerHandler(service + 'OpenLocal', open)
    waitForFingerprint()
    const reconnecting = reconnectSessionTab('tab-1', sessions)
    await vi.advanceTimersByTimeAsync(RECONNECT_ATTEMPT_TIMEOUT_MS * 3 + 2000)
    await reconnecting
    expect(open).toHaveBeenCalledTimes(3)
    expect(useAppStore.getState().connectionStatus['term-old']).toBe('error')
  })
})
