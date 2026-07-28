import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { useConnectDialog } from '@/store/connectDialog'
import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { markIntentionalDisconnect, reconnectSessionTab } from '@/hooks/sessionReconnect'
import { runBatchDeleteSessions, runBatchSessions } from '@/lib/sessionBatch'
import { cancelTransfersForSessions, closeTerminalTabsForSessions, openSessionTab } from '@/hooks/sessionTabLifecycle'
import type { Session } from '@/lib/sessionModels'
import { t } from '@/i18n'

type SetSessions = Dispatch<SetStateAction<Session[]>>

export interface SessionConnectionOptions {
  sessions: Session[]
  setSessions: SetSessions
  setRecentSessions: SetSessions
  listSessions: (options?: { silent?: boolean }) => Promise<void>
  listRecentSessions: (options?: { silent?: boolean }) => Promise<void>
  refreshAssets: (options?: { silent?: boolean }) => Promise<void>
}

export function useConnectSession(options: SessionConnectionOptions) {
  const connect = useCallback(async (sessionId: string) => {
    const session = options.sessions.find((item) => item.id === sessionId)
    if (!session) return
    const dialog = useConnectDialog.getState()
    if (dialog.open) return void toast(t('已有 SSH 连接正在处理，请先完成或关闭当前连接窗口'), 'info')
    const controller = new AbortController()
    const dialogId = dialog.openDialog(session.host, session.port, session.username, () => { void connect(sessionId) }, sessionId)
    dialog.setCancelHandler(dialogId, () => controller.abort())
    try {
      const terminalId = await openSessionTab(session, controller.signal)
      dialog.completeDialog(dialogId)
      logger.info('connected', { terminalId, host: session.host })
      refreshSessionLists(options)
    } catch (error) {
      if (controller.signal.aborted) return
      logger.error('connect error', error)
      dialog.failDialog(dialogId, error instanceof Error ? error.message : String(error))
    }
  }, [options.listRecentSessions, options.listSessions, options.sessions])
  return connect
}

export function useBatchSessionActions(options: SessionConnectionOptions) {
  const runBatch = useBatchRunner(options)
  const batchConnect = useCallback((sessionIDs: string[]) => runBatch(sessionIDs), [runBatch])
  const batchExecuteMacro = useCallback((sessionIDs: string[], command: string) => runBatch(sessionIDs, command), [runBatch])
  const batchDeleteSessions = useBatchDeleteSessions(options)
  return { batchConnect, batchExecuteMacro, batchDeleteSessions }
}

function useBatchRunner(options: SessionConnectionOptions) {
  return useCallback(async (sessionIDs: string[], command?: string) => {
    const selected = selectSessions(options.sessions, sessionIDs)
    const results = await runBatchSessions(selected, command)
    refreshAssets(options.refreshAssets, 'batch post-refresh failed')
    return results
  }, [options.refreshAssets, options.sessions])
}

function useBatchDeleteSessions(options: SessionConnectionOptions) {
  return useCallback(async (sessionIDs: string[]) => {
    const results = await runBatchDeleteSessions(selectSessions(options.sessions, sessionIDs))
    const succeeded = new Set(results.filter((result) => result.success).map((result) => result.sessionId))
    if (succeeded.size > 0) await applyDeletedSessions({ ...options, succeeded })
    refreshAssets(options.refreshAssets, 'batch delete post-refresh failed')
    return results
  }, [options])
}

export function useTerminalConnectionActions(sessions: Session[]) {
  const disconnect = useCallback(async (terminalId: string) => {
    try {
      markIntentionalDisconnect(terminalId)
      await TerminalService.Close(terminalId)
      useAppStore.getState().setConnectionStatus(terminalId, 'disconnected')
    } catch (error) {
      logger.error('disconnect error', error)
      throw error
    }
  }, [])
  const reconnect = useCallback((tabId: string) => reconnectSessionTab(tabId, sessions), [sessions])
  return { reconnect, disconnect }
}

async function applyDeletedSessions(options: SessionConnectionOptions & { succeeded: Set<string> }) {
  const { succeeded } = options
  options.setSessions((current) => current.filter((session) => !succeeded.has(session.id)))
  options.setRecentSessions((current) => current.filter((session) => !succeeded.has(session.id)))
  useConnectDialog.getState().dismissForSessions(succeeded)
  cancelTransfersForSessions(succeeded)
  await closeTerminalTabsForSessions(succeeded)
}

function refreshSessionLists(options: SessionConnectionOptions) {
  void Promise.all([options.listRecentSessions({ silent: true }), options.listSessions({ silent: true })])
    .catch((error: unknown) => logger.error('connect post-refresh failed', error))
}

function refreshAssets(refresh: SessionConnectionOptions['refreshAssets'], message: string) {
  void refresh({ silent: true }).catch((error: unknown) => logger.error(message, error))
}

function selectSessions(sessions: Session[], sessionIDs: string[]) {
  return sessionIDs.map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is Session => session !== undefined)
}
