import { Events } from '@wailsio/runtime'
import { useAppStore } from '@/store/appStore'
import { useConnectDialog } from '@/store/connectDialog'

interface EventEnvelope<T> { data?: T }
interface ConnectionPayload { terminal_id?: string; attempt_id?: string; state?: string }
interface FingerprintPayload { attempt_id?: string; fingerprint?: string; algorithm?: string }
interface TransferPayload {
  task_id?: string
  status?: 'running' | 'completed' | 'cancelled'
  transferred?: number
  total?: number
  speed?: number
  eta?: number
}
interface TransferErrorPayload { task_id?: string; error?: string }

export function startEventBridge(): () => void {
  const unsubscribers = [
    Events.On('session:attempt', (event: EventEnvelope<ConnectionPayload>) => {
      const attemptId = event.data?.attempt_id
      if (attemptId) useConnectDialog.getState().setAttempt(attemptId)
    }),
    Events.On('session:fingerprint', (event: EventEnvelope<FingerprintPayload>) => {
      const payload = event.data
      if (payload?.attempt_id && payload.fingerprint) {
        useConnectDialog.getState().setFingerprint(payload.attempt_id, payload.fingerprint, payload.algorithm ?? '')
      }
    }),
    Events.On('session:state', (event: EventEnvelope<ConnectionPayload>) => {
      const payload = event.data
      if (!payload?.terminal_id || !payload.state) return
      if (payload.state === 'connected') useAppStore.getState().setConnectionStatus(payload.terminal_id, 'connected')
      if (payload.state === 'disconnected') useAppStore.getState().setConnectionStatus(payload.terminal_id, 'disconnected')
    }),
    Events.On('terminal:closed', (event: EventEnvelope<ConnectionPayload>) => {
      const terminalId = event.data?.terminal_id
      if (!terminalId) return
      const state = useAppStore.getState()
      const tab = state.tabs.find((item) => item.terminalId === terminalId)
      if (tab) state.removeTabLocal(tab.id)
    }),
    Events.On('tunnel:state', (event: EventEnvelope<ConnectionPayload>) => {
      const payload = event.data
      if (!payload?.terminal_id || (payload.state !== 'running' && payload.state !== 'stopped')) return
      const tunnelId = payload.terminal_id.replace(/^tunnel-/, '')
      useAppStore.getState().setTunnelState(tunnelId, payload.state)
    }),
    Events.On('file:progress', (event: EventEnvelope<TransferPayload>) => {
      const payload = event.data
      if (!payload?.task_id) return
      useAppStore.getState().updateTransfer(payload.task_id, {
        transferredBytes: payload.transferred ?? 0,
        totalBytes: payload.total ?? 0,
        speed: payload.speed ?? 0,
        eta: payload.eta ?? 0,
        status: 'running',
      })
    }),
    Events.On('file:complete', (event: EventEnvelope<TransferPayload>) => {
      const payload = event.data
      if (!payload?.task_id) return
      useAppStore.getState().updateTransfer(payload.task_id, {
        transferredBytes: payload.transferred ?? 0,
        totalBytes: payload.total ?? 0,
        status: payload.status === 'cancelled' ? 'cancelled' : 'completed',
        completedAt: Date.now(),
      })
    }),
    Events.On('file:error', (event: EventEnvelope<TransferErrorPayload>) => {
      const payload = event.data
      if (!payload?.task_id) return
      useAppStore.getState().updateTransfer(payload.task_id, { status: 'failed', error: payload.error ?? '文件传输失败', completedAt: Date.now() })
    }),
  ]
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}
