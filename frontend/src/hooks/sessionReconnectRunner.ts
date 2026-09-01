import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useConnectDialog } from '@/store/connectDialog'
import { useAppStore, type AppState } from '@/store/appStore'
import { toast } from '@/components/ui/toast'
import { openTerminalWithPoolCapacity, releaseAppTerminalOpenReservation } from '@/lib/openTerminal'
import { t } from '@/i18n'
import { bindWailsCallToSignal } from '@/lib/wailsCancellation'

export interface ReconnectSession {
  id: string
  host: string
  port: number
  username: string
}

interface ReconnectRun {
  tabID: string
  terminalID: string
  controller: AbortController
  ownsDialog: boolean
  dialogID: number
}

interface ReconnectContext {
  state: AppState
  tabID: string
  terminalID: string
  session: ReconnectSession
  terminal?: { cols?: number; rows?: number }
  run: ReconnectRun
}

const reconnectRuns = new Map<string, ReconnectRun>()
const reconnectDelays = [500, 1000]
export const RECONNECT_ATTEMPT_TIMEOUT_MS = 30_000
const hostKeyRejectedMarker = 'host key rejected by user'
let reconnectDialogOwner: ReconnectRun | null = null

function currentReconnectTarget(tabID: string, sessions: ReconnectSession[]) {
  const state = useAppStore.getState()
  const tab = state.tabs.find((item) => item.id === tabID)
  if (!tab || tab.type !== 'terminal') return null
  const status = state.connectionStatus[tab.terminalId]
  if (status !== 'disconnected' && status !== 'error') return null
  if (tab.connectionKind === 'serial') {
    if (!tab.serialPortId) return null
    return { state, tab, terminalID: tab.terminalId, session: { id: `serial:${tab.serialPortId}`, host: tab.title, port: 0, username: 'serial' } }
  }
  if (tab.connectionKind === 'local') {
    return { state, tab, terminalID: tab.terminalId, session: { id: 'local', host: tab.title || 'local', port: 0, username: 'local' } }
  }
  const session = sessions.find((item) => Number(item.id) === tab.sessionId)
  return session ? { state, tab, terminalID: tab.terminalId, session } : null
}

export function isSSHReconnectTarget(tabID: string, terminalID: string, sessions: ReconnectSession[]) {
  const target = currentReconnectTarget(tabID, sessions)
  return target?.terminalID === terminalID && (target.tab.connectionKind ?? 'ssh') === 'ssh'
}

function closeOwnedReconnectDialog(run: ReconnectRun) {
  if (reconnectDialogOwner !== run) return
  reconnectDialogOwner = null
  useConnectDialog.getState().closeDialog(run.dialogID)
}

function restoreDisconnectedState(tabID: string, terminalID: string) {
  const state = useAppStore.getState()
  const tab = state.tabs.find((item) => item.id === tabID)
  if (tab?.type !== 'terminal' || tab.terminalId !== terminalID) return false
  state.setConnectionStatus(terminalID, 'disconnected')
  return true
}

function cancelReconnectRun(run: ReconnectRun) {
  run.controller.abort()
  restoreDisconnectedState(run.tabID, run.terminalID)
  closeOwnedReconnectDialog(run)
}

export function cancelRunningReconnectForTab(tabID: string): boolean {
  const run = reconnectRuns.get(tabID)
  if (!run) return false
  cancelReconnectRun(run)
  return true
}

export function cancelRunningReconnectForTerminal(terminalID: string) {
  for (const run of reconnectRuns.values()) {
    if (run.terminalID === terminalID) cancelReconnectRun(run)
  }
}

export function shutdownReconnectRuns() {
  for (const run of reconnectRuns.values()) cancelReconnectRun(run)
  reconnectRuns.clear()
  reconnectDialogOwner = null
}

export function handleReconnectDialogClosed() {
  const run = reconnectDialogOwner
  reconnectDialogOwner = null
  if (run && reconnectRuns.get(run.tabID) === run) {
    run.controller.abort()
    restoreDisconnectedState(run.tabID, run.terminalID)
  }
}

function openReconnectTerminal(context: ReconnectContext) {
  if (context.run.controller.signal.aborted) return Promise.reject(new Error('reconnect cancelled'))
  const tab = useAppStore.getState().tabs.find((item) => item.id === context.tabID)
  const cols = context.terminal?.cols ?? 80
  const rows = context.terminal?.rows ?? 24
  const call = tab?.type === 'terminal' && tab.connectionKind === 'serial' && tab.serialPortId
    ? TerminalService.OpenSerial(tab.serialPortId, cols, rows)
    : tab?.type === 'terminal' && tab.connectionKind === 'local'
      ? TerminalService.OpenLocal(cols, rows)
      : TerminalService.Open(Number(context.session.id), cols, rows)
  return withReconnectTimeout(call, context.run.controller)
}

function withReconnectTimeout<T>(call: Promise<T>, runController: AbortController): Promise<T> {
  const timeoutController = new AbortController()
  const abortTimeout = () => timeoutController.abort()
  runController.signal.addEventListener('abort', abortTimeout, { once: true })
  let timeoutHandle: number | null = null
  const callResult = bindWailsCallToSignal(call, timeoutController.signal)
  const timeout = new Promise<T>((_resolve, reject) => {
    timeoutHandle = window.setTimeout(() => {
      abortTimeout()
      reject(new Error('reconnect attempt timed out'))
    }, RECONNECT_ATTEMPT_TIMEOUT_MS)
  })
  return Promise.race([callResult, timeout]).finally(() => {
    if (timeoutHandle !== null) window.clearTimeout(timeoutHandle)
    runController.signal.removeEventListener('abort', abortTimeout)
  })
}

async function closeStaleTerminal(terminalID: string) {
  releaseAppTerminalOpenReservation(terminalID)
  try {
    await TerminalService.Close(terminalID)
  } catch (error: unknown) {
    logger.error('reconnect stale terminal cleanup failed', error)
  }
}

async function openAndInstallTerminal(context: ReconnectContext): Promise<boolean> {
  const nextTerminalID = await openTerminalWithPoolCapacity(
    () => openReconnectTerminal(context),
    { replacementTerminalID: context.terminalID },
  )
  if (context.run.controller.signal.aborted
    || !useAppStore.getState().replaceTerminalConnection(context.tabID, context.terminalID, nextTerminalID)) {
    await closeStaleTerminal(nextTerminalID)
    closeOwnedReconnectDialog(context.run)
    return false
  }
  if (reconnectDialogOwner === context.run) {
    reconnectDialogOwner = null
    useConnectDialog.getState().completeDialog(context.run.dialogID)
  }
  logger.info('reconnected', {
    previousTerminalId: context.terminalID,
    terminalId: nextTerminalID,
    host: context.session.host,
  })
  return true
}

function handleReconnectFailure(context: ReconnectContext, error: unknown, finalAttempt: boolean) {
  if (context.run.controller.signal.aborted
    || !restoreDisconnectedState(context.tabID, context.terminalID)) {
    closeOwnedReconnectDialog(context.run)
    return false
  }
  logger.error('reconnect error', error)
  if (!finalAttempt) {
    context.state.setConnectionStatus(context.terminalID, 'reconnecting')
    return true
  }
  context.state.setConnectionStatus(context.terminalID, 'error')
  if (reconnectDialogOwner === context.run) {
    useConnectDialog.getState().failDialog(context.run.dialogID, error instanceof Error ? error.message : String(error))
  }
  return false
}

function isHostKeyRejected(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes(hostKeyRejectedMarker)
}

function shouldOpenReconnectDialog(context: {
  source: 'manual' | 'auto'
  tabID: string
  connectionKind?: 'ssh' | 'serial' | 'local'
}) {
  if ((context.connectionKind ?? 'ssh') !== 'ssh') return false
  if (context.source === 'manual') return true
  const activeSurface = useAppStore.getState().activeSurface
  return activeSurface?.type === 'terminal' && activeSurface.id === context.tabID
}

async function runReconnectAttempts(context: ReconnectContext) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (context.run.controller.signal.aborted) return
    try {
      await openAndInstallTerminal(context)
      return
    } catch (error: unknown) {
      const finalAttempt = attempt === 2 || isHostKeyRejected(error)
      if (!handleReconnectFailure(context, error, finalAttempt)) return
      await waitForReconnect(reconnectDelays[attempt], context.run.controller.signal)
    }
  }
}

export async function performReconnectSessionTab(
  tabID: string,
  sessions: ReconnectSession[],
  source: 'manual' | 'auto',
) {
  if (reconnectRuns.has(tabID)) return
  const target = currentReconnectTarget(tabID, sessions)
  if (!target) return
  const dialog = useConnectDialog.getState()
  if (dialog.open) {
    if (source === 'manual') toast(t('已有 SSH 连接正在处理，请先完成或关闭当前连接窗口'), 'info')
    return
  }
  const run: ReconnectRun = {
    tabID,
    terminalID: target.terminalID,
    controller: new AbortController(),
    ownsDialog: shouldOpenReconnectDialog({ source, tabID, connectionKind: target.tab.connectionKind }),
    dialogID: 0,
  }
  if (run.ownsDialog) {
    run.dialogID = dialog.openDialog(target.session.host, target.session.port, target.session.username, () => {
      void performReconnectSessionTab(tabID, sessions, 'manual')
    }, String(target.session.id))
    dialog.setCancelHandler(run.dialogID, () => run.controller.abort())
    reconnectDialogOwner = run
  }
  reconnectRuns.set(tabID, run)
  target.state.setConnectionStatus(target.terminalID, 'reconnecting')
  try {
    await runReconnectAttempts({
      state: target.state,
      tabID,
      terminalID: target.terminalID,
      session: target.session,
      terminal: target.state.terminalPool.get(target.terminalID)?.terminal,
      run,
    })
  } finally {
    if (reconnectRuns.get(tabID) === run) reconnectRuns.delete(tabID)
  }
}

function waitForReconnect(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timer = window.setTimeout(resolve, delay)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
