import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useConnectDialog } from '@/store/connectDialog'
import { useAppStore } from '@/store/appStore'
import { toast } from '@/components/ui/toast'

interface ReconnectSession {
  id: string
  host: string
  port: number
  username: string
}

function currentReconnectTarget(tabId: string, sessions: ReconnectSession[]) {
  const state = useAppStore.getState()
  const tab = state.tabs.find((item) => item.id === tabId)
  if (!tab || tab.type !== 'terminal' || state.connectionStatus[tab.terminalId] === 'connecting') return null
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
  state.setConnectionStatus(terminalId, 'connecting')
  try {
    const nextTerminalId = await TerminalService.Open(Number(session.id), terminal?.cols ?? 80, terminal?.rows ?? 24)
    if (!useAppStore.getState().replaceTerminalConnection(tabId, terminalId, nextTerminalId)) {
      await closeStaleTerminal(nextTerminalId)
      dialog.closeDialog()
      return
    }
    dialog.setState('connected')
    logger.info('reconnected', { previousTerminalId: terminalId, terminalId: nextTerminalId, host: session.host })
  } catch (error: unknown) {
    if (!restoreDisconnectedState(tabId, terminalId)) {
      dialog.closeDialog()
      return
    }
    logger.error('reconnect error', error)
    dialog.setError(error instanceof Error ? error.message : String(error))
  }
}
