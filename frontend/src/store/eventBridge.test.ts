import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '@/components/ui/toast'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { restoreTransfers, startEventBridge } from '@/store/eventBridge'
import { useAppStore } from '@/store/appStore'
import { useConnectDialog } from '@/store/connectDialog'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'
import { TERMINAL_CLOSED_SPLIT_PANE_EVENT } from '@/hooks/sessionReconnect'

const sessionService = 'github.com/xuthus5/mssh/internal/service.SessionService.'

describe('eventBridge', () => {
  beforeEach(() => {
    __clearHandlers()
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListTransfers', async () => [])
    __registerHandler(sessionService + 'DecideHostKey', async () => {})
    __registerHandler(sessionService + 'CancelConnect', async () => {})
    useAppStore.setState({ tabs: [], transfers: [], tunnelState: {}, connectionStatus: {} })
    useConnectDialog.setState({
      open: false, state: 'idle', host: '', port: 0, user: '', sessionId: '', error: '',
      dialogId: 0, cancelRequest: null, retry: null,
    })
    useHostKeyPromptDialog.setState({ active: null, pending: false, error: '' })
  })

  it('shows a host key prompt without replacing a busy connection dialog', () => {
    useConnectDialog.getState().openDialog('foreground.internal', 22, 'root', vi.fn(), '9')
    const stop = startEventBridge()
    __emitEvent('session:fingerprint', { data: {
      attempt_id: 'attempt-background', hostname: '[2001:db8::1]:2222',
      fingerprint: 'SHA256:key', algorithm: 'ssh-ed25519',
    } })
    expect(useHostKeyPromptDialog.getState().active).toMatchObject({
      endpoint: { host: '2001:db8::1', port: 2222 },
      prompt: { attemptId: 'attempt-background', fingerprint: 'SHA256:key', algorithm: 'ssh-ed25519' },
    })
    expect(useConnectDialog.getState()).toMatchObject({
      open: true, state: 'connecting', host: 'foreground.internal', sessionId: '9',
    })
    __emitEvent('session:attempt', { data: { attempt_id: 'attempt-unrelated' } })
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('attempt-background')
    stop()
  })

  it('queues additional fingerprints behind the active security prompt', async () => {
    const stop = startEventBridge()
    emitFingerprint('first')
    emitFingerprint('second')
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('attempt-first')

    await useHostKeyPromptDialog.getState().decide(true)

    await waitFor(() => expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('attempt-second'))
    stop()
  })

  it('rejects fingerprints that exceed the bounded prompt queue', async () => {
    const decide = vi.fn(async () => {})
    __registerHandler(sessionService + 'DecideHostKey', decide)
    const stop = startEventBridge()

    for (let index = 1; index <= 34; index++) {
      __emitEvent('session:fingerprint', { data: {
        attempt_id: `attempt-${index}`, hostname: `host-${index}.internal:22`,
        fingerprint: `SHA256:${index}`, algorithm: 'ssh-ed25519',
      } })
    }

    await waitFor(() => expect(decide).toHaveBeenCalledWith('attempt-34', false))
    stop()
  })

  it('fails closed when a fingerprint event omits endpoint data', async () => {
    const decide = vi.fn(async () => {})
    __registerHandler(sessionService + 'DecideHostKey', decide)
    const stop = startEventBridge()

    __emitEvent('session:fingerprint', { data: {
      attempt_id: 'attempt-malformed', fingerprint: 'SHA256:malformed', algorithm: 'ssh-ed25519',
    } })

    await waitFor(() => expect(decide).toHaveBeenCalledWith('attempt-malformed', false))
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    stop()
  })

  it('rejects active and queued prompts when the event bridge stops', async () => {
    const decide = vi.fn(async () => {})
    __registerHandler(sessionService + 'DecideHostKey', decide)
    const stop = startEventBridge()
    emitFingerprint('first')
    emitFingerprint('second')

    stop()
    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith('attempt-first', false)
      expect(decide).toHaveBeenCalledWith('attempt-second', false)
    })
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
  })

  it('maps transfer terminal states and errors', () => {
    useAppStore.getState().addTransfer({ id: 'task-1', fileName: 'a', direction: 'upload', sessionId: 1, sessionName: 'one', sourcePath: '/a', targetPath: '/b', totalBytes: 10, transferredBytes: 0, speed: 0, eta: 0, status: 'queued', startedAt: 0 })
    const stop = startEventBridge()
    __emitEvent('file:progress', { data: { task_id: 'task-1', transferred: 5, total: 10, speed: 2, eta: 3 } })
    expect(useAppStore.getState().transfers[0]).toMatchObject({ status: 'running', transferredBytes: 5, eta: 3 })
    __emitEvent('file:complete', { data: { task_id: 'task-1', status: 'cancelled', transferred: 5, total: 10 } })
    expect(useAppStore.getState().transfers[0].status).toBe('cancelled')
    expect(useAppStore.getState().transfers[0].completedAt).toEqual(expect.any(Number))
    // Late I/O error after session-delete cancel must not regress cancelled jobs.
    __emitEvent('file:error', { data: { task_id: 'task-1', error: 'denied' } })
    expect(useAppStore.getState().transfers[0]).toMatchObject({ status: 'cancelled' })
    __emitEvent('file:progress', { data: { task_id: 'task-1', transferred: 9, total: 10, speed: 1, eta: 1 } })
    expect(useAppStore.getState().transfers[0]).toMatchObject({ status: 'cancelled', transferredBytes: 5 })
    __emitEvent('file:complete', { data: { task_id: 'task-1', status: 'completed', transferred: 10, total: 10 } })
    expect(useAppStore.getState().transfers[0]).toMatchObject({ status: 'cancelled' })
    stop()
  })

  it('maps terminal closure and tunnel state then unsubscribes', () => {
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'one', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
    })
    const stop = startEventBridge()
    __emitEvent('tunnel:state', { data: { terminal_id: 'tunnel-9', state: 'running' } })
    expect(useAppStore.getState().tunnelState['9']).toBe('running')
    __emitEvent('terminal:closed', { data: { terminal_id: 'term-1' } })
    expect(useAppStore.getState().tabs).toHaveLength(0)
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'workspace', id: 'sessions' })
    stop()
    __emitEvent('tunnel:state', { data: { terminal_id: 'tunnel-9', state: 'stopped' } })
    expect(useAppStore.getState().tunnelState['9']).toBe('running')
  })

  it('notifies the owning split when a secondary terminal closes', () => {
    useAppStore.setState({
      tabs: [{
        id: 'tab-split', title: 'split', type: 'terminal', terminalId: 'term-primary', sessionId: 1,
        splitPaneIDs: ['term-primary', 'term-secondary'],
      }],
      terminalPool: new Map([['term-secondary', { terminal: {} as never, lastUsed: 1 }]]),
      connectionStatus: { 'term-secondary': 'connected' },
      recordingState: { 'term-secondary': 'recording' },
      terminalOpenReservations: new Set(['term-secondary']),
    })
    const onClosed = vi.fn()
    window.addEventListener(TERMINAL_CLOSED_SPLIT_PANE_EVENT, onClosed)
    const stop = startEventBridge()

    __emitEvent('terminal:closed', { data: { terminal_id: 'term-secondary' } })

    expect(onClosed).toHaveBeenCalledOnce()
    expect(onClosed.mock.calls[0][0]).toMatchObject({
      detail: { tabID: 'tab-split', terminalID: 'term-secondary' },
    })
    expect(useAppStore.getState().tabs[0]).toMatchObject({ splitPaneIDs: ['term-primary'] })
    expect(useAppStore.getState().terminalPool.has('term-secondary')).toBe(false)
    expect(useAppStore.getState().connectionStatus['term-secondary']).toBeUndefined()
    expect(useAppStore.getState().recordingState['term-secondary']).toBeUndefined()
    expect(useAppStore.getState().terminalOpenReservations).toEqual(new Set())

    stop()
    window.removeEventListener(TERMINAL_CLOSED_SPLIT_PANE_EVENT, onClosed)
  })

  it('maps connection states and ignores incomplete events', () => {
    const stop = startEventBridge()
    __emitEvent('session:state', { data: {} })
    __emitEvent('session:state', { data: { terminal_id: 'term-ignored', state: 'connecting' } })
    __emitEvent('session:state', { data: { terminal_id: 'term-1', state: 'connected' } })
    __emitEvent('session:state', { data: { terminal_id: 'term-2', state: 'disconnected' } })
    __emitEvent('terminal:closed', { data: {} })
    __emitEvent('terminal:closed', { data: { terminal_id: 'missing' } })
    __emitEvent('tunnel:state', { data: {} })
    __emitEvent('tunnel:state', { data: { terminal_id: 'tunnel-3', state: 'failed' } })

    expect(useAppStore.getState().connectionStatus).toEqual({
      'term-1': 'connected',
      'term-2': 'disconnected',
    })
    expect(useAppStore.getState().tunnelState).toEqual({})
    stop()
  })

  it('uses transfer defaults and ignores events without task identifiers', () => {
    useAppStore.getState().addTransfer({ id: 'task-2', fileName: 'b', direction: 'download', sessionId: 2, sessionName: 'two', sourcePath: '/b', targetPath: '/c', totalBytes: 10, transferredBytes: 4, speed: 3, eta: 2, status: 'queued', startedAt: 0 })
    const stop = startEventBridge()

    __emitEvent('file:progress', { data: {} })
    __emitEvent('file:complete', { data: {} })
    __emitEvent('file:error', { data: {} })
    expect(useAppStore.getState().transfers[0].status).toBe('queued')

    __emitEvent('file:progress', { data: { task_id: 'task-2' } })
    expect(useAppStore.getState().transfers[0]).toMatchObject({ transferredBytes: 0, totalBytes: 0, speed: 0, eta: 0, status: 'running' })
    __emitEvent('file:complete', { data: { task_id: 'task-2' } })
    expect(useAppStore.getState().transfers[0]).toMatchObject({ transferredBytes: 0, totalBytes: 0, status: 'completed' })
    __emitEvent('file:error', { data: { task_id: 'task-2' } })
    expect(useAppStore.getState().transfers[0]).toMatchObject({ status: 'completed' })
    // Still allow failed when transfer is non-terminal.
    useAppStore.getState().updateTransfer('task-2', { status: 'running', error: '' })
    __emitEvent('file:error', { data: { task_id: 'task-2', error: 'denied' } })
    expect(useAppStore.getState().transfers[0]).toMatchObject({ status: 'failed', error: 'denied' })
    stop()
  })
})

function emitFingerprint(suffix: string) {
  __emitEvent('session:fingerprint', { data: {
    attempt_id: `attempt-${suffix}`,
    hostname: `${suffix}.internal:22`,
    fingerprint: `SHA256:${suffix}`,
    algorithm: 'ssh-ed25519',
  } })
}

describe('restoreTransfers', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    useAppStore.setState({ transfers: [], transfersLoadError: '' })
  })

  it('restores persisted backend transfer history', async () => {
    __clearHandlers()
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListTransfers', async () => [{ id: 'saved', session_id: 3, session_name: 'server', direction: 'upload', source_path: '/tmp/a.txt', target_path: '/a.txt', total_bytes: 10, transferred_bytes: 10, speed: 2, eta: 0, status: 'completed', error: '', started_at: '2026-07-17T00:00:00Z', completed_at: '2026-07-17T00:00:05Z' }])
    await restoreTransfers()
    expect(useAppStore.getState().transfers).toEqual([expect.objectContaining({ id: 'saved', fileName: 'a.txt', status: 'completed', sessionId: 3 })])
    expect(useAppStore.getState().transfersLoadError).toBe('')
  })

  it('records restoreTransfers failures without toast', async () => {
    __clearHandlers()
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListTransfers', async () => { throw new Error('list transfers failed') })
    await restoreTransfers()
    expect(useAppStore.getState().transfersLoadError).toBe('list transfers failed')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps the newest transfer restore when responses resolve out of order', async () => {
    __clearHandlers()
    const first = deferred<unknown[]>()
    const second = deferred<unknown[]>()
    let call = 0
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListTransfers', async () => {
      call += 1
      return (call === 1 ? first : second).promise
    })
    const firstRestore = restoreTransfers()
    const secondRestore = restoreTransfers()
    second.resolve([{ id: 'new', session_id: 1, session_name: 'new', direction: 'upload', source_path: '/new', target_path: '/remote/new', total_bytes: 1, transferred_bytes: 1, speed: 1, eta: 0, status: 'completed', error: '', started_at: '2026-07-25T00:00:00Z', completed_at: '2026-07-25T00:00:01Z' }])
    await secondRestore
    first.resolve([{ id: 'old', session_id: 1, session_name: 'old', direction: 'upload', source_path: '/old', target_path: '/remote/old', total_bytes: 1, transferred_bytes: 1, speed: 1, eta: 0, status: 'completed', error: '', started_at: '2026-07-25T00:00:00Z', completed_at: '2026-07-25T00:00:01Z' }])
    await firstRestore
    expect(useAppStore.getState().transfers[0].id).toBe('new')
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
