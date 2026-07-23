import { useAppStore } from '@/store/appStore'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { createTerminalTab } from '@/lib/terminalTabs'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { resolveOpenTerminalSize } from '@/lib/terminalOpenSize'
import type { Session } from '@/lib/sessionModels'
import { t } from '@/i18n'

export async function openSessionTab(session: Session): Promise<string> {
  const size = resolveOpenTerminalSize()
  const terminalId = await openTerminalWithPoolCapacity(
    () => TerminalService.Open(Number(session.id), size.cols, size.rows),
  )
  const store = useAppStore.getState()
  const tab = createTerminalTab({ sessionID: Number(session.id), sessionName: session.name, terminalID: terminalId, tabs: store.tabs })
  store.setConnectionStatus(terminalId, 'connected')
  store.openTab(tab)
  return terminalId
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

