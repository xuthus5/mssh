import { useAppStore } from '@/store/appStore'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { createTerminalTab } from '@/lib/terminalTabs'
import { openTerminalWithPoolCapacity, releaseAppTerminalOpenReservation } from '@/lib/openTerminal'
import { resolveOpenTerminalSize } from '@/lib/terminalOpenSize'
import type { Session } from '@/lib/sessionModels'
import { t } from '@/i18n'
import { bindWailsCallToSignal } from '@/lib/wailsCancellation'

export async function openSessionTab(session: Session, signal?: AbortSignal): Promise<string> {
  const size = resolveOpenTerminalSize()
  const terminalId = await openTerminalWithPoolCapacity(
    () => bindWailsCallToSignal(TerminalService.Open(Number(session.id), size.cols, size.rows), signal),
  )
  if (signal?.aborted) {
    await closeCancelledTerminal(terminalId)
    throw connectionCancelledError(signal)
  }
  const store = useAppStore.getState()
  const tab = createTerminalTab({
    sessionID: Number(session.id),
    sessionName: session.name,
    terminalID: terminalId,
    tabs: store.tabs,
    connectionInfo: {
      host: session.host,
      port: session.port,
      username: session.username,
    },
  })
  store.setConnectionStatus(terminalId, 'connected')
  store.openTab(tab)
  return terminalId
}

async function closeCancelledTerminal(terminalId: string) {
  releaseAppTerminalOpenReservation(terminalId)
  try {
    await TerminalService.Close(terminalId)
  } catch (error: unknown) {
    logger.error('close cancelled terminal failed', error)
  }
}

function connectionCancelledError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error('connection cancelled')
  error.name = 'AbortError'
  return error
}


export async function closeTerminalTabsForSessions(sessionIDs: Iterable<string>) {
  const targets = new Set([...sessionIDs].map(String))
  if (targets.size === 0) return
  const store = useAppStore.getState()
  const tabs = store.tabs.filter((tab) => (
    tab.type === 'terminal'
    && (tab.connectionKind ?? 'ssh') === 'ssh'
    && targets.has(String(tab.sessionId))
  ))
  for (const tab of tabs) {
    try {
      await store.closeTab(tab.id)
    } catch (error) {
      logger.error('close session terminal tab failed', tab.id, error)
    }
  }
}


export function cancelTransfersForSessions(sessionIDs: Iterable<string>) {
  const targets = new Set([...sessionIDs].map(String).filter(Boolean))
  if (targets.size === 0) return
  const store = useAppStore.getState()
  for (const transfer of store.transfers) {
    if (!targets.has(String(transfer.sessionId))) continue
    if (transfer.status !== 'queued' && transfer.status !== 'running') continue
    store.updateTransfer(transfer.id, {
      status: 'cancelled',
      error: t('会话已删除'),
      completedAt: Date.now(),
    })
  }
}
