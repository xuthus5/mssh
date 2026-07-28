import { Events } from '@wailsio/runtime'
import { useAppStore, type AppState, type TransferJob } from '@/store/appStore'
import { FileService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'
import { mapBackendTransferJobs } from '@/lib/transferDTO'
import {
  maybeAutoReconnectTerminal,
  shutdownReconnectRuntime,
  TERMINAL_CLOSED_SPLIT_PANE_EVENT,
  type ReconnectSession,
  type TerminalClosedSplitPaneDetail,
} from '@/hooks/sessionReconnect'
import { releaseAppTerminalOpenReservation } from '@/lib/openTerminal'
import { scrubTerminalRuntime } from '@/store/terminalTabPanes'
import { createHostKeyPromptCoordinator } from '@/store/hostKeyPromptCoordinator'


interface EventEnvelope<T> { data?: T }

let reconnectSessionProvider: (() => ReconnectSession[]) | null = null
let transferRestoreRequestID = 0
const pendingTransferUpdates = new Map<string, TransferUpdate>()
const maxPendingTransferUpdates = 256

/** Register a live session list provider for auto-reconnect lookups. */
export function setReconnectSessionProvider(provider: (() => ReconnectSession[]) | null) {
  reconnectSessionProvider = provider
}

function reconnectSessions(): ReconnectSession[] {
  return reconnectSessionProvider?.() ?? []
}

interface ConnectionPayload { terminal_id?: string; state?: string }
interface FingerprintPayload { attempt_id?: string; hostname?: string; fingerprint?: string; algorithm?: string }
interface TransferPayload {
  task_id?: string
  status?: 'running' | 'completed' | 'cancelled'
  transferred?: number
  total?: number
  speed?: number
  eta?: number
}
interface TransferErrorPayload { task_id?: string; error?: string }
type TransferUpdate = Partial<Pick<TransferJob,
  'transferredBytes' | 'speed' | 'totalBytes' | 'eta' | 'status' | 'error' | 'completedAt'>>

function invalidateTransferRestore() {
  transferRestoreRequestID++
}

function transferSnapshot(taskID: string): TransferJob | TransferUpdate | undefined {
  return useAppStore.getState().transfers.find((job) => job.id === taskID) ?? pendingTransferUpdates.get(taskID)
}

function rememberTransferUpdate(taskID: string, updates: TransferUpdate) {
  const existing = pendingTransferUpdates.get(taskID)
  pendingTransferUpdates.delete(taskID)
  pendingTransferUpdates.set(taskID, { ...existing, ...updates })
  if (pendingTransferUpdates.size <= maxPendingTransferUpdates) return
  const oldest = pendingTransferUpdates.keys().next().value
  if (oldest) pendingTransferUpdates.delete(oldest)
}

function applyTransferUpdate(taskID: string, updates: TransferUpdate) {
  invalidateTransferRestore()
  const current = useAppStore.getState().transfers.find((job) => job.id === taskID)
  if (current) {
    useAppStore.getState().updateTransfer(taskID, updates)
    return
  }
  rememberTransferUpdate(taskID, updates)
}

function consumeTransferUpdate(job: TransferJob): TransferJob {
  const pending = pendingTransferUpdates.get(job.id)
  if (!pending) return job
  pendingTransferUpdates.delete(job.id)
  return { ...job, ...pending }
}

export function registerStartedTransfer(job: TransferJob) {
  invalidateTransferRestore()
  const pending = pendingTransferUpdates.get(job.id)
  pendingTransferUpdates.delete(job.id)
  useAppStore.setState((state) => {
    const index = state.transfers.findIndex((transfer) => transfer.id === job.id)
    const existing = index >= 0 ? state.transfers[index] : undefined
    const registered = { ...job, ...existing, ...pending }
    const transfers = index < 0
      ? [...state.transfers, registered]
      : state.transfers.map((transfer, itemIndex) => itemIndex === index ? registered : transfer)
    return { transfers, transferCenterOpen: true, transfersLoadError: '' }
  })
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

function secondaryTabForTerminal(state: AppState, terminalID: string) {
  return state.tabs.find((item) => item.type === 'terminal'
    && item.terminalId !== terminalID
    && (item.splitPaneIDs ?? []).includes(terminalID))
}

function scrubClosedSecondary(state: AppState, tabID: string, terminalID: string): Partial<AppState> {
  const tabs = state.tabs.map((item) => {
    if (item.id !== tabID || item.type !== 'terminal') return item
    return {
      ...item,
      splitPaneIDs: item.splitPaneIDs?.filter((paneID) => paneID !== terminalID),
      splitLayout: null,
    }
  })
  return { tabs, ...scrubTerminalRuntime(state, [terminalID]) }
}

function notifyClosedSecondary(tabID: string, terminalID: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<TerminalClosedSplitPaneDetail>(TERMINAL_CLOSED_SPLIT_PANE_EVENT, {
    detail: { tabID, terminalID },
  }))
}

function handleTerminalClosed(event: EventEnvelope<ConnectionPayload>) {
	const terminalId = event.data?.terminal_id
	if (!terminalId) return
	releaseAppTerminalOpenReservation(terminalId)
  const state = useAppStore.getState()
  const tab = state.tabs.find((item) => item.type === 'terminal' && item.terminalId === terminalId)
  if (tab) state.removeTabLocal(tab.id)
  if (tab) return
  const secondaryTab = secondaryTabForTerminal(state, terminalId)
  if (!secondaryTab) return
	useAppStore.setState((current) => scrubClosedSecondary(current, secondaryTab.id, terminalId))
  notifyClosedSecondary(secondaryTab.id, terminalId)
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
  const current = transferSnapshot(payload.task_id)
  // Ignore progress after a terminal status (session-delete cancel races).
  if (current && (current.status === 'cancelled' || current.status === 'completed' || current.status === 'failed')) return
  applyTransferUpdate(payload.task_id, {
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
  const current = transferSnapshot(payload.task_id)
  const nextStatus = payload.status === 'cancelled' ? 'cancelled' : 'completed'
  // Keep session-delete cancelled over a late completed/failed-complete race.
  if (current?.status === 'cancelled' && nextStatus === 'completed') return
  applyTransferUpdate(payload.task_id, {
    transferredBytes: payload.transferred ?? current?.transferredBytes ?? 0,
    totalBytes: payload.total ?? current?.totalBytes ?? 0,
    status: nextStatus,
    completedAt: Date.now(),
  })
}

function handleFileError(event: EventEnvelope<TransferErrorPayload>) {
  const payload = event.data
  if (!payload?.task_id) return
  const current = transferSnapshot(payload.task_id)
  // Session-delete cancel may race a late I/O error; keep cancelled terminal.
  if (current?.status === 'cancelled' || current?.status === 'completed') return
  applyTransferUpdate(payload.task_id, {
    status: 'failed', error: payload.error ?? t('文件传输失败'), completedAt: Date.now(),
  })
}

export function startEventBridge(): () => void {
  pendingTransferUpdates.clear()
  void restoreTransfers()
  const hostKeyPrompts = createHostKeyPromptCoordinator()
  const unsubscribers = [
    Events.On('session:fingerprint', (event: EventEnvelope<FingerprintPayload>) => {
      const payload = event.data
      if (!payload?.attempt_id) return
      hostKeyPrompts.handle({
        attemptId: payload.attempt_id,
        hostname: payload.hostname ?? '',
        fingerprint: payload.fingerprint ?? '',
        algorithm: payload.algorithm ?? '',
      })
    }),
    Events.On('session:state', handleSessionState),
    Events.On('terminal:closed', handleTerminalClosed),
    Events.On('tunnel:state', handleTunnelState),
    Events.On('file:progress', handleFileProgress),
    Events.On('file:complete', handleFileComplete),
    Events.On('file:error', handleFileError),
  ]
  return function stopEventBridge() {
    invalidateTransferRestore()
    pendingTransferUpdates.clear()
    for (const unsubscribe of unsubscribers) unsubscribe()
    hostKeyPrompts.stop()
    shutdownReconnectRuntime()
  }
}

export async function restoreTransfers() {
  const requestID = ++transferRestoreRequestID
  try {
    const raw = await FileService.ListTransfers()
    if (requestID !== transferRestoreRequestID) return
    const { jobs, errors } = mapBackendTransferJobs(raw)
    if (errors.length > 0) {
      logger.error('restoreTransfers mapping failures', { count: errors.length, errors: errors.slice(0, 5) })
    }
    useAppStore.setState({ transfers: jobs.map(consumeTransferUpdate), transfersLoadError: '' })
  } catch (error: unknown) {
    if (requestID !== transferRestoreRequestID) return
    const message = error instanceof Error ? error.message : String(error)
    logger.error('restoreTransfers failed', error)
    useAppStore.setState({ transfersLoadError: message })
  }
}
