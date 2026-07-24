import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { isTerminalNotFoundError } from '@/store/tabNavigation'
import {
  hasTerminal,
  insertSplit,
  removeTerminal,
  replaceTerminal,
  terminalIDs,
  type SplitDirection,
  type SplitNode,
} from '@/components/terminal/splitTree'
import {
  closeInBackground,
  openSplitTerminal,
  replaceSecondaryTerminalRuntime,
} from '@/components/terminal/splitPersistence'
import { t } from '@/i18n'

export const MAX_SPLIT_PANES = 8

export function closeSplitTerminalInBackground(terminalID: string, context: string) {
  closeInBackground(terminalID, context, isTerminalNotFoundError)
}

export function openSplitPane(
  sessionId: number,
  connectionKind: 'ssh' | 'serial' | 'local' | undefined,
  serialPortId: number | undefined,
  preferredTerminalID: string,
) {
  return openSplitTerminal(sessionId, connectionKind, serialPortId, t('串口终端为设备独占，不支持分屏'), preferredTerminalID)
}

type SplitActionContext = {
  tabID: string
  primaryID: string
  sessionId: number
  connectionKind?: 'ssh' | 'serial' | 'local'
  serialPortId?: number
  activePaneID: string | null
  treeRef: { current: SplitNode }
  primaryRef: { current: string }
  operationRef: { current: boolean }
  mountedRef: { current: boolean }
  setTree: (updater: (current: SplitNode) => SplitNode) => void
  setBusy: (busy: boolean) => void
  setClosingID?: (id: string | null) => void
  setActionError?: (message: string) => void
  requestFocus: (terminalID: string) => void
  lastUsed: (terminalID: string) => number
  onPaneClosed?: (terminalID: string) => void
  onPaneReplaced?: (previousID: string, nextID: string) => void
}

export async function splitPane(direction: SplitDirection, ctx: SplitActionContext) {
  if (ctx.operationRef.current || ctx.connectionKind === 'serial') {
    if (ctx.connectionKind === 'serial') toast(t('串口终端为设备独占，不支持分屏'), 'warning')
    return
  }
  if (terminalIDs(ctx.treeRef.current).length >= MAX_SPLIT_PANES) {
    toast(t('每个标签最多支持 8 个终端窗格'), 'warning')
    return
  }
  const targetID = ctx.activePaneID && hasTerminal(ctx.treeRef.current, ctx.activePaneID)
    ? ctx.activePaneID
    : ctx.primaryID
  ctx.operationRef.current = true
  ctx.setBusy(true)
  ctx.setActionError?.('')
  try {
    const terminalID = await openTerminalWithPoolCapacity(() => openSplitPane(
      ctx.sessionId, ctx.connectionKind, ctx.serialPortId, ctx.primaryRef.current,
    ))
    if (!ctx.mountedRef.current) {
      closeSplitTerminalInBackground(terminalID, 'TerminalSplit: cancelled split cleanup failed')
      return
    }
    ctx.setTree((current) => insertSplit(current, targetID, terminalID, direction, crypto.randomUUID()))
    useAppStore.getState().setConnectionStatus(terminalID, 'connected')
    ctx.requestFocus(terminalID)
  } catch (error: unknown) {
    logger.error('TerminalSplit: failed to open split', error)
    ctx.setActionError?.(t('创建分屏失败: ${}', error instanceof Error ? error.message : String(error)))
  } finally {
    ctx.operationRef.current = false
    if (ctx.mountedRef.current) ctx.setBusy(false)
  }
}

export async function closeSplitPane(terminalID: string, ctx: SplitActionContext) {
  if (ctx.operationRef.current || terminalIDs(ctx.treeRef.current).length === 1) return
  ctx.operationRef.current = true
  ctx.setBusy(true)
  ctx.setClosingID?.(terminalID)
  ctx.setActionError?.('')
  try {
    await TerminalService.Close(terminalID).catch((error: unknown) => {
      if (!isTerminalNotFoundError(error)) throw error
    })
    const result = removeTerminal(ctx.treeRef.current, terminalID, ctx.lastUsed)
    if (!result) return
    if (terminalID === ctx.primaryID) {
      ctx.primaryRef.current = result.focusID
      useAppStore.getState().promoteTerminalConnection(ctx.tabID, terminalID, result.focusID)
    } else {
      useAppStore.getState().forgetTerminal(terminalID)
    }
    ctx.setTree(() => result.node)
    ctx.onPaneClosed?.(terminalID)
    ctx.requestFocus(result.focusID)
  } catch (error: unknown) {
    logger.error('TerminalSplit: failed to close pane', error)
    ctx.setActionError?.(t('关闭分屏失败: ${}', error instanceof Error ? error.message : String(error)))
  } finally {
    ctx.operationRef.current = false
    if (ctx.mountedRef.current) ctx.setBusy(false)
    if (ctx.mountedRef.current) ctx.setClosingID?.(null)
  }
}

export async function reconnectSplitPane(terminalID: string, ctx: SplitActionContext) {
  if (ctx.operationRef.current || ctx.connectionKind === 'serial') return
  ctx.operationRef.current = true
  useAppStore.getState().setConnectionStatus(terminalID, 'reconnecting')
  ctx.setBusy(true)
  try {
    const nextID = await openTerminalWithPoolCapacity(() => openSplitPane(
      ctx.sessionId, ctx.connectionKind, ctx.serialPortId, ctx.primaryRef.current,
    ))
    if (!ctx.mountedRef.current) {
      closeSplitTerminalInBackground(nextID, 'TerminalSplit: cancelled reconnect cleanup failed')
      return
    }
    ctx.setTree((current) => replaceTerminal(current, terminalID, nextID))
    if (terminalID === ctx.primaryID) {
      ctx.primaryRef.current = nextID
      useAppStore.getState().replaceTerminalConnection(ctx.tabID, terminalID, nextID)
    } else {
      replaceSecondaryTerminalRuntime(terminalID, nextID, ctx.tabID)
    }
    useAppStore.getState().setConnectionStatus(nextID, 'connected')
    ctx.onPaneReplaced?.(terminalID, nextID)
    closeSplitTerminalInBackground(terminalID, 'TerminalSplit: old reconnect terminal cleanup failed')
    ctx.requestFocus(nextID)
  } catch (error: unknown) {
    logger.error('TerminalSplit: failed to reconnect pane', error)
    // ConnectionOverlay owns recovery UX for error status; avoid toast + overlay double reporting.
    useAppStore.getState().setConnectionStatus(terminalID, 'error')
  } finally {
    ctx.operationRef.current = false
    if (ctx.mountedRef.current) ctx.setBusy(false)
  }
}
