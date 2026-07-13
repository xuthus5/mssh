import { beforeEach, describe, expect, it } from 'vitest'
import { __clearHandlers, __emitEvent } from '@/test/__mocks__/wails-runtime'
import { startEventBridge } from '@/store/eventBridge'
import { useAppStore } from '@/store/appStore'
import { useConnectDialog } from '@/store/connectDialog'

describe('eventBridge', () => {
  beforeEach(() => {
    __clearHandlers()
    useAppStore.setState({ tabs: [], transfers: [], tunnelState: {}, connectionStatus: {} })
    useConnectDialog.setState({ open: false, state: 'idle', attemptId: '', fingerprint: '', algorithm: '', error: '' })
  })

  it('maps host-key attempt and fingerprint events', () => {
    const stop = startEventBridge()
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
    __emitEvent('file:error', { data: { task_id: 'task-1', error: 'denied' } })
    expect(useAppStore.getState().transfers[0]).toMatchObject({ status: 'failed', error: 'denied' })
    expect(useAppStore.getState().transfers[0].completedAt).toEqual(expect.any(Number))
    stop()
  })

  it('maps terminal closure and tunnel state then unsubscribes', () => {
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'one', type: 'terminal', terminalId: 'term-1' }],
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
})
