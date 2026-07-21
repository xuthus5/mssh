import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useConnectDialog } from '@/store/connectDialog'
import { useAppStore } from '@/store/appStore'
import { toast } from '@/components/ui/toast'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'

interface ReconnectSession {
  id: string
  host: string
  port: number
  username: string
}

const reconnectControllers = new Map<string, AbortController>()
const reconnectDelays = [500, 1000]

function currentReconnectTarget(tabId: string, sessions: ReconnectSession[]) {
  const state = useAppStore.getState()
  const tab = state.tabs.find((item) => item.id === tabId)
  if (!tab || tab.type !== 'terminal' || ['connecting', 'reconnecting'].includes(state.connectionStatus[tab.terminalId] ?? '')) return null
  const session = sessions.find((item) => Number(item.id) === tab.sessionId)
  if (!session) return null
  const terminalId = tab.terminalId
  return { state, tab, terminalId, session }
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
    toast('已有 SSH 连接正在处理，请先完成或关闭当前连接窗口', 'info')
    return
  }
  const terminal = state.terminalPool.get(terminalId)?.terminal
  dialog.openDialog(session.host, session.port, session.username, () => { void reconnectSessionTab(tabId, sessions) })
  const controller = new AbortController()
  reconnectControllers.set(tabId, controller)
  state.setConnectionStatus(terminalId, 'reconnecting')
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const nextTerminalId = await openTerminalWithPoolCapacity(() => TerminalService.Open(Number(session.id), terminal?.cols ?? 80, terminal?.rows ?? 24))
        if (controller.signal.aborted || !useAppStore.getState().replaceTerminalConnection(tabId, terminalId, nextTerminalId)) { await closeStaleTerminal(nextTerminalId); dialog.closeDialog(); return }
        dialog.setState('connected')
        logger.info('reconnected', { previousTerminalId: terminalId, terminalId: nextTerminalId, host: session.host })
        return
      } catch (error: unknown) {
        if (controller.signal.aborted || !restoreDisconnectedState(tabId, terminalId)) { dialog.closeDialog(); return }
        logger.error('reconnect error', error)
        if (attempt === 2) { state.setConnectionStatus(terminalId, 'error'); dialog.setError(error instanceof Error ? error.message : String(error)); return }
        state.setConnectionStatus(terminalId, 'reconnecting')
        await waitForReconnect(reconnectDelays[attempt], controller.signal)
      }
    }
  } finally {
    if (reconnectControllers.get(tabId) === controller) reconnectControllers.delete(tabId)
  }
}

function waitForReconnect(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return }
    const timer = window.setTimeout(resolve, delay)
    signal.addEventListener('abort', () => { window.clearTimeout(timer); resolve() }, { once: true })
  })
}
