import { logger } from '@/lib/logger'
import { useConnectDialog } from '@/store/connectDialog'
import { useAppStore } from '@/store/appStore'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { AutoReconnectScheduler } from '@/hooks/autoReconnectScheduler'
import {
  cancelRunningReconnectForTab,
  cancelRunningReconnectForTerminal,
  handleReconnectDialogClosed,
  isSSHReconnectTarget,
  performReconnectSessionTab,
  shutdownReconnectRuns,
  type ReconnectSession,
} from '@/hooks/sessionReconnectRunner'

export type { ReconnectSession } from '@/hooks/sessionReconnectRunner'

const intentionalDisconnects = new Set<string>()
const intentionalDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
const MAX_PENDING_AUTO_RECONNECTS = 256
let reconnectRuntimeUnsubscribers: Array<() => void> = []

function createAutoReconnectScheduler() {
  return new AutoReconnectScheduler({
    maxPending: MAX_PENDING_AUTO_RECONNECTS,
    isBlocked: () => useConnectDialog.getState().open,
    onError: (error) => logger.error('auto reconnect scheduler failed', error),
  })
}

let autoReconnectScheduler = createAutoReconnectScheduler()

export const RECONNECT_SPLIT_PANE_EVENT = 'mssh:reconnect-split-pane' as const
export const TERMINAL_CLOSED_SPLIT_PANE_EVENT = 'mssh:terminal-closed-split-pane' as const

export type ReconnectSplitPaneDetail = {
  tabID: string
  terminalID: string
  accept: (start: () => Promise<void>) => void
}
export type TerminalClosedSplitPaneDetail = { tabID: string; terminalID: string }

function ensureReconnectRuntime() {
  if (reconnectRuntimeUnsubscribers.length > 0) return
  reconnectRuntimeUnsubscribers = [
    useConnectDialog.subscribe((state, previous) => {
      if (state.open) return
      if (previous.open) handleReconnectDialogClosed()
      autoReconnectScheduler.wake()
    }),
    useTerminalBehaviorStore.subscribe((state, previous) => {
      if (!state.autoReconnect) {
        autoReconnectScheduler.clear()
        return
      }
      if (!previous.autoReconnect) autoReconnectScheduler.wake()
    }),
    useAppStore.subscribe(() => autoReconnectScheduler.prune()),
  ]
}

/** Stop queued/in-flight reconnect work during app or event-bridge shutdown. */
export function shutdownReconnectRuntime() {
  autoReconnectScheduler.clear()
  autoReconnectScheduler = createAutoReconnectScheduler()
  shutdownReconnectRuns()
  for (const timer of intentionalDisconnectTimers.values()) clearTimeout(timer)
  intentionalDisconnectTimers.clear()
  intentionalDisconnects.clear()
  for (const unsubscribe of reconnectRuntimeUnsubscribers) unsubscribe()
  reconnectRuntimeUnsubscribers = []
}

/** Mark a terminal close as user-initiated so auto-reconnect is skipped. */
export function markIntentionalDisconnect(terminalId: string) {
  autoReconnectScheduler.cancelTerminal(terminalId)
  cancelRunningReconnectForTerminal(terminalId)
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

export async function reconnectSessionTab(tabId: string, sessions: ReconnectSession[]) {
  ensureReconnectRuntime()
  if (cancelRunningReconnectForTab(tabId)) {
    autoReconnectScheduler.cancelTab(tabId)
    return
  }
  if (!useConnectDialog.getState().open) autoReconnectScheduler.cancelTab(tabId)
  await performReconnectSessionTab(tabId, sessions, 'manual')
}

function findTerminalTabForPane(terminalId: string) {
  return useAppStore.getState().tabs.find((item) => {
    if (item.type !== 'terminal') return false
    if (item.terminalId === terminalId) return true
    return (item.splitPaneIDs ?? []).includes(terminalId)
  })
}

function requestSplitPaneReconnect(tabID: string, terminalID: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  return new Promise((resolve) => {
    let accepted = false
    const detail: ReconnectSplitPaneDetail = {
      tabID,
      terminalID,
      accept: (start) => {
        if (accepted) return
        accepted = true
        let operation: Promise<void>
        try {
          operation = start()
        } catch (error: unknown) {
          logger.error('split pane auto reconnect failed', error)
          resolve()
          return
        }
        void operation.then(resolve, (error: unknown) => {
          logger.error('split pane auto reconnect failed', error)
          resolve()
        })
      },
    }
    window.dispatchEvent(new CustomEvent(RECONNECT_SPLIT_PANE_EVENT, { detail }))
    if (!accepted) resolve()
  })
}

function isQueuedAutoReconnectEligible(tabID: string, terminalID: string, sessions: ReconnectSession[]) {
  return useTerminalBehaviorStore.getState().autoReconnect
    && isSSHReconnectTarget(tabID, terminalID, sessions)
}

function queueAutoReconnect(tabID: string, terminalID: string, sessions: ReconnectSession[]) {
  ensureReconnectRuntime()
  const result = autoReconnectScheduler.enqueue({
    tabID,
    terminalID,
    canRun: () => isQueuedAutoReconnectEligible(tabID, terminalID, sessions),
    run: () => performReconnectSessionTab(tabID, sessions, 'auto'),
    cancel: () => cancelRunningReconnectForTerminal(terminalID),
  })
  if (result === 'full') logger.warn('auto reconnect queue full', { tabID, terminalID })
}

function isQueuedSplitReconnectEligible(tabID: string, terminalID: string) {
  if (!useTerminalBehaviorStore.getState().autoReconnect) return false
  const state = useAppStore.getState()
  const tab = state.tabs.find((item) => item.id === tabID)
  return tab?.type === 'terminal'
    && (tab.connectionKind ?? 'ssh') === 'ssh'
    && (tab.splitPaneIDs ?? []).includes(terminalID)
    && state.connectionStatus[terminalID] === 'disconnected'
}

function queueSplitAutoReconnect(tabID: string, terminalID: string) {
  ensureReconnectRuntime()
  const result = autoReconnectScheduler.enqueue({
    tabID,
    terminalID,
    canRun: () => isQueuedSplitReconnectEligible(tabID, terminalID),
    run: () => requestSplitPaneReconnect(tabID, terminalID),
    cancel: () => {},
  })
  if (result === 'full') logger.warn('auto reconnect queue full', { tabID, terminalID })
}

/** Auto-reconnect after unexpected disconnect when the setting is enabled. */
export function maybeAutoReconnectTerminal(terminalId: string, sessions: ReconnectSession[]) {
  if (consumeIntentionalDisconnect(terminalId)) return
  if (!useTerminalBehaviorStore.getState().autoReconnect) return
  const tab = findTerminalTabForPane(terminalId)
  if (!tab || tab.type !== 'terminal') return
  // Serial DTR can reset MCUs, while a local shell exit is process completion rather than an SSH outage.
  if (tab.connectionKind === 'serial' || tab.connectionKind === 'local') return
  if (tab.terminalId === terminalId) {
    queueAutoReconnect(tab.id, terminalId, sessions)
    return
  }
  // Secondary split panes reconnect through TerminalSplit tree state.
  queueSplitAutoReconnect(tab.id, terminalId)
}
