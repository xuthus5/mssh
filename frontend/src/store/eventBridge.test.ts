import { beforeEach, describe, expect, it } from 'vitest'
import { useToastStore } from '@/components/ui/toast'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { restoreTransfers, startEventBridge } from '@/store/eventBridge'
import { useAppStore } from '@/store/appStore'
import { useConnectDialog } from '@/store/connectDialog'

describe('eventBridge', () => {
  beforeEach(() => {
    __clearHandlers()
    useAppStore.setState({ tabs: [], transfers: [], tunnelState: {}, connectionStatus: {} })
    useConnectDialog.setState({ open: false, state: 'idle', attemptId: '', sessionId: '', fingerprint: '', algorithm: '', error: '' })
  })

  it('maps host-key attempt and fingerprint events', () => {
    const stop = startEventBridge()
    __emitEvent('session:attempt', { data: {} })
    __emitEvent('session:fingerprint', { data: { attempt_id: 'attempt-ignored' } })
    __emitEvent('session:attempt', { data: { attempt_id: 'attempt-1' } })
    __emitEvent('session:fingerprint', { data: { attempt_id: 'attempt-1', fingerprint: 'SHA256:key', algorithm: 'ssh-ed25519' } })
    expect(useConnectDialog.getState()).toMatchObject({ attemptId: 'attempt-1', fingerprint: 'SHA256:key', algorithm: 'ssh-ed25519' })
    stop()
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

describe('restoreTransfers', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('restores persisted backend transfer history', async () => {
    __clearHandlers()
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListTransfers', async () => [{ id: 'saved', session_id: 3, session_name: 'server', direction: 'upload', source_path: '/tmp/a.txt', target_path: '/a.txt', total_bytes: 10, transferred_bytes: 10, speed: 2, eta: 0, status: 'completed', error: '', started_at: '2026-07-17T00:00:00Z', completed_at: '2026-07-17T00:00:05Z' }])
    await restoreTransfers()
    expect(useAppStore.getState().transfers).toEqual([expect.objectContaining({ id: 'saved', fileName: 'a.txt', status: 'completed', sessionId: 3 })])
  })
})

  it('toasts restoreTransfers failures', async () => {
    __clearHandlers()
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListTransfers', async () => { throw new Error('list transfers failed') })
    await restoreTransfers()
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('list transfers failed'))).toBe(true)
  })
