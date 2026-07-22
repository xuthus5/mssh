import { Events } from '@wailsio/runtime'
import { useAppStore } from '@/store/appStore'
import { useConnectDialog } from '@/store/connectDialog'
import { FileService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { mapBackendTransferJobs } from '@/lib/transferDTO'
import { t } from '@/i18n'
import { maybeAutoReconnectTerminal, type ReconnectSession } from '@/hooks/sessionReconnect'


interface EventEnvelope<T> { data?: T }

let reconnectSessionProvider: (() => ReconnectSession[]) | null = null

/** Register a live session list provider for auto-reconnect lookups. */
export function setReconnectSessionProvider(provider: (() => ReconnectSession[]) | null) {
  reconnectSessionProvider = provider
}

function reconnectSessions(): ReconnectSession[] {
  return reconnectSessionProvider?.() ?? []
}

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

function handleSessionAttempt(event: EventEnvelope<ConnectionPayload>) {
  const attemptId = event.data?.attempt_id
  if (attemptId) useConnectDialog.getState().setAttempt(attemptId)
}

function handleFingerprint(event: EventEnvelope<FingerprintPayload>) {
  const payload = event.data
  if (!payload?.attempt_id || !payload.fingerprint) return
  useConnectDialog.getState().setFingerprint(payload.attempt_id, payload.fingerprint, payload.algorithm ?? '')
}

function handleSessionState(event: EventEnvelope<ConnectionPayload>) {
  const payload = event.data
  if (!payload?.terminal_id || !payload.state) return
  if (payload.state === 'connected') {
    useAppStore.getState().setConnectionStatus(payload.terminal_id, 'connected')
  }
  if (payload.state === 'disconnected') {
    useAppStore.getState().setConnectionStatus(payload.terminal_id, 'disconnected')
    maybeAutoReconnectTerminal(payload.terminal_id, reconnectSessions())
  }
}

function handleTerminalClosed(event: EventEnvelope<ConnectionPayload>) {
  const terminalId = event.data?.terminal_id
  if (!terminalId) return
  const state = useAppStore.getState()
  const tab = state.tabs.find((item) => item.type === 'terminal' && item.terminalId === terminalId)
  if (tab) state.removeTabLocal(tab.id)
}

function handleTunnelState(event: EventEnvelope<ConnectionPayload>) {
  const payload = event.data
  if (!payload?.terminal_id || (payload.state !== 'running' && payload.state !== 'stopped')) return
  const tunnelId = payload.terminal_id.replace(/^tunnel-/, '')
  useAppStore.getState().setTunnelState(tunnelId, payload.state)
}

function handleFileProgress(event: EventEnvelope<TransferPayload>) {
  const payload = event.data
  if (!payload?.task_id) return
  useAppStore.getState().updateTransfer(payload.task_id, {
    transferredBytes: payload.transferred ?? 0,
    totalBytes: payload.total ?? 0,
    speed: payload.speed ?? 0,
    eta: payload.eta ?? 0,
    status: 'running',
  })
}

function handleFileComplete(event: EventEnvelope<TransferPayload>) {
  const payload = event.data
  if (!payload?.task_id) return
  useAppStore.getState().updateTransfer(payload.task_id, {
    transferredBytes: payload.transferred ?? 0,
    totalBytes: payload.total ?? 0,
    status: payload.status === 'cancelled' ? 'cancelled' : 'completed',
    completedAt: Date.now(),
  })
}

function handleFileError(event: EventEnvelope<TransferErrorPayload>) {
  const payload = event.data
  if (!payload?.task_id) return
  useAppStore.getState().updateTransfer(payload.task_id, {
    status: 'failed', error: payload.error ?? t('文件传输失败'), completedAt: Date.now(),
  })
}

export function startEventBridge(): () => void {
  void restoreTransfers()
  const unsubscribers = [
    Events.On('session:attempt', handleSessionAttempt),
    Events.On('session:fingerprint', handleFingerprint),
    Events.On('session:state', handleSessionState),
    Events.On('terminal:closed', handleTerminalClosed),
    Events.On('tunnel:state', handleTunnelState),
    Events.On('file:progress', handleFileProgress),
    Events.On('file:complete', handleFileComplete),
    Events.On('file:error', handleFileError),
  ]
  return function stopEventBridge() {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}

export async function restoreTransfers() {
  try {
    const raw = await FileService.ListTransfers()
    const { jobs, errors } = mapBackendTransferJobs(raw)
    if (errors.length > 0) {
      logger.error('restoreTransfers mapping failures', { count: errors.length, errors: errors.slice(0, 5) })
    }
    useAppStore.setState({ transfers: jobs })
  } catch (error: unknown) {
    logger.error('restoreTransfers failed', error)
  }
}
