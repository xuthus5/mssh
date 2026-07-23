import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useConnectDialog } from '@/store/connectDialog'
import { useAppStore } from '@/store/appStore'
import { toast } from '@/components/ui/toast'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { t } from '@/i18n'

export interface ReconnectSession {
  id: string
  host: string
  port: number
  username: string
}

const reconnectControllers = new Map<string, AbortController>()
const reconnectDelays = [500, 1000]
const intentionalDisconnects = new Set<string>()
const intentionalDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const RECONNECT_SPLIT_PANE_EVENT = 'mssh:reconnect-split-pane' as const

export type ReconnectSplitPaneDetail = { tabID: string; terminalID: string }

/** Mark a terminal close as user-initiated so auto-reconnect is skipped. */
export function markIntentionalDisconnect(terminalId: string) {
  intentionalDisconnects.add(terminalId)
  const existing = intentionalDisconnectTimers.get(terminalId)
  if (existing !== undefined) clearTimeout(existing)
  intentionalDisconnectTimers.set(
    terminalId,
    setTimeout(() => {
      intentionalDisconnects.delete(terminalId)
      intentionalDisconnectTimers.delete(terminalId)
    }, 5000),
  )
}

export function consumeIntentionalDisconnect(terminalId: string): boolean {
  const existing = intentionalDisconnectTimers.get(terminalId)
  if (existing !== undefined) {
    clearTimeout(existing)
    intentionalDisconnectTimers.delete(terminalId)
  }
  if (!intentionalDisconnects.has(terminalId)) return false
  intentionalDisconnects.delete(terminalId)
  return true
}

function currentReconnectTarget(tabId: string, sessions: ReconnectSession[]) {
  const state = useAppStore.getState()
  const tab = state.tabs.find((item) => item.id === tabId)
  if (!tab || tab.type !== 'terminal' || ['connecting', 'reconnecting'].includes(state.connectionStatus[tab.terminalId] ?? '')) {
    return null
  }
  if (tab.connectionKind === 'serial') {
    if (!tab.serialPortId) return null
    const session: ReconnectSession = {
      id: `serial:${tab.serialPortId}`,
      host: tab.title,
      port: 0,
      username: 'serial',
    }
    return { state, tab, terminalId: tab.terminalId, session }
  }
  if (tab.connectionKind === 'local') {
    const session: ReconnectSession = {
      id: 'local',
      host: tab.title || 'local',
      port: 0,
      username: 'local',
    }
    return { state, tab, terminalId: tab.terminalId, session }
  }
  const session = sessions.find((item) => Number(item.id) === tab.sessionId)
  if (!session) return null
  return { state, tab, terminalId: tab.terminalId, session }
}

async function closeStaleTerminal(terminalId: string) {
  try {
    await TerminalService.Close(terminalId)
  } catch (error: unknown) {
    logger.error('reconnect stale terminal cleanup failed', error)
  }
}

function restoreDisconnectedState(tabId: string, terminalId: string) {
  const state = useAppStore.getState()
  const currentTab = state.tabs.find((item) => item.id === tabId)
  if (currentTab?.type !== 'terminal' || currentTab.terminalId !== terminalId) return false
  state.setConnectionStatus(terminalId, 'disconnected')
  return true
}

export async function reconnectSessionTab(tabId: string, sessions: ReconnectSession[]) {
  const running = reconnectControllers.get(tabId)
  if (running) {
    running.abort()
    reconnectControllers.delete(tabId)
    const tab = useAppStore.getState().tabs.find((item) => item.id === tabId)
    if (tab?.type === 'terminal') useAppStore.getState().setConnectionStatus(tab.terminalId, 'disconnected')
    useConnectDialog.getState().closeDialog()
    return
  }
  const target = currentReconnectTarget(tabId, sessions)
  if (!target) return
  const { state, terminalId, session } = target
  const dialog = useConnectDialog.getState()
  if (dialog.open) {
    toast(t('已有 SSH 连接正在处理，请先完成或关闭当前连接窗口'), 'info')
    return
  }
  const terminal = state.terminalPool.get(terminalId)?.terminal
  const tabMeta = state.tabs.find((item) => item.id === tabId)
  const kind = tabMeta?.type === 'terminal' ? (tabMeta.connectionKind ?? 'ssh') : 'ssh'
  const skipHostDialog = kind === 'serial' || kind === 'local'
  if (!skipHostDialog) {
    dialog.openDialog(session.host, session.port, session.username, () => {
      void reconnectSessionTab(tabId, sessions)
    }, String(session.id))
  }
  const controller = new AbortController()
  reconnectControllers.set(tabId, controller)
  state.setConnectionStatus(terminalId, 'reconnecting')
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const nextTerminalId = await openTerminalWithPoolCapacity(() => {
          const tab = useAppStore.getState().tabs.find((item) => item.id === tabId)
          if (tab?.type === 'terminal' && tab.connectionKind === 'serial' && tab.serialPortId) {
            return TerminalService.OpenSerial(tab.serialPortId, terminal?.cols ?? 80, terminal?.rows ?? 24)
          }
          if (tab?.type === 'terminal' && tab.connectionKind === 'local') {
            return TerminalService.OpenLocal(terminal?.cols ?? 80, terminal?.rows ?? 24)
          }
          return TerminalService.Open(Number(session.id), terminal?.cols ?? 80, terminal?.rows ?? 24)
        })
        if (
          controller.signal.aborted
          || !useAppStore.getState().replaceTerminalConnection(tabId, terminalId, nextTerminalId)
        ) {
          await closeStaleTerminal(nextTerminalId)
          dialog.closeDialog()
          return
        }
        dialog.setState('connected')
        logger.info('reconnected', { previousTerminalId: terminalId, terminalId: nextTerminalId, host: session.host })
        return
      } catch (error: unknown) {
        if (controller.signal.aborted || !restoreDisconnectedState(tabId, terminalId)) {
          dialog.closeDialog()
          return
        }
        logger.error('reconnect error', error)
        if (attempt === 2) {
          const message = error instanceof Error ? error.message : String(error)
          state.setConnectionStatus(terminalId, 'error')
          dialog.setError(message)
          return
        }
        state.setConnectionStatus(terminalId, 'reconnecting')
        await waitForReconnect(reconnectDelays[attempt], controller.signal)
      }
    }
  } finally {
    if (reconnectControllers.get(tabId) === controller) reconnectControllers.delete(tabId)
  }
}

function findTerminalTabForPane(terminalId: string) {
  return useAppStore.getState().tabs.find((item) => {
    if (item.type !== 'terminal') return false
    if (item.terminalId === terminalId) return true
    return (item.splitPaneIDs ?? []).includes(terminalId)
  })
}

function requestSplitPaneReconnect(tabID: string, terminalID: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ReconnectSplitPaneDetail>(RECONNECT_SPLIT_PANE_EVENT, {
    detail: { tabID, terminalID },
  }))
}

/** Auto-reconnect after unexpected disconnect when the setting is enabled. */
export function maybeAutoReconnectTerminal(terminalId: string, sessions: ReconnectSession[]) {
  if (consumeIntentionalDisconnect(terminalId)) return
  if (!useTerminalBehaviorStore.getState().autoReconnect) return
  const tab = findTerminalTabForPane(terminalId)
  if (!tab || tab.type !== 'terminal') return
  // Serial DTR-on-open can reset MCUs; never auto-reopen serial ports.
  if (tab.connectionKind === 'serial') return
  if (tab.terminalId === terminalId) {
    void reconnectSessionTab(tab.id, sessions)
    return
  }
  // Secondary split panes reconnect through TerminalSplit tree state.
  requestSplitPaneReconnect(tab.id, terminalId)
}

function waitForReconnect(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = window.setTimeout(resolve, delay)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
