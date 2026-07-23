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

export function useSessionConnectionActions(options: {
  sessions: Session[]
  setSessions: SetSessions
  setRecentSessions: SetSessions
  listSessions: (options?: { silent?: boolean }) => Promise<void>
  listRecentSessions: (options?: { silent?: boolean }) => Promise<void>
  refreshAssets: (options?: { silent?: boolean }) => Promise<void>
}) {
  const { sessions, setSessions, setRecentSessions, listSessions, listRecentSessions, refreshAssets } = options

  const connect = useCallback(async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return
    const dialog = useConnectDialog.getState()
    if (dialog.open) return void toast(t('已有 SSH 连接正在处理，请先完成或关闭当前连接窗口'), 'info')
    dialog.openDialog(session.host, session.port, session.username, () => { void connect(sessionId) }, sessionId)
    try {
      const terminalId = await openSessionTab(session)
      dialog.setState('connected')
      logger.info('connected', { terminalId, host: session.host })
      // Session is already open; refresh failures must not flip the dialog to failed.
      void Promise.all([
        listRecentSessions({ silent: true }),
        listSessions({ silent: true }),
      ]).catch((refreshError: unknown) => {
        logger.error('connect post-refresh failed', refreshError)
      })
    } catch (err) {
      logger.error('connect error', err)
      const msg = err instanceof Error ? err.message : String(err)
      dialog.setError(msg)
    }
  }, [listRecentSessions, listSessions, sessions])

  const runBatch = useCallback(async (sessionIDs: string[], command?: string) => {
    const selected = sessionIDs.map((id) => sessions.find((session) => session.id === id)).filter((session): session is Session => session !== undefined)
    const results = await runBatchSessions(selected, command)
    // Batch outcomes are already final; silent refresh must not block or rebrand success as failure.
    void refreshAssets({ silent: true }).catch((refreshError: unknown) => {
      logger.error('batch post-refresh failed', refreshError)
    })
    return results
  }, [refreshAssets, sessions])
  const batchConnect = useCallback((sessionIDs: string[]) => runBatch(sessionIDs), [runBatch])
  const batchExecuteMacro = useCallback((sessionIDs: string[], command: string) => runBatch(sessionIDs, command), [runBatch])
  const batchDeleteSessions = useCallback(async (sessionIDs: string[]) => {
    const selected = sessionIDs.map((id) => sessions.find((session) => session.id === id)).filter((session): session is Session => session !== undefined)
    const results = await runBatchDeleteSessions(selected)
    const succeeded = new Set(results.filter((result) => result.success).map((result) => result.sessionId))
    if (succeeded.size > 0) {
      setSessions((prev) => prev.filter((session) => !succeeded.has(session.id)))
      setRecentSessions((prev) => prev.filter((session) => !succeeded.has(session.id)))
      useConnectDialog.getState().dismissForSessions(succeeded)
      cancelTransfersForSessions(succeeded)
      await closeTerminalTabsForSessions(succeeded)
    }
    // Local delete results already applied; silent refresh reconciles without aborting the results dialog.
    void refreshAssets({ silent: true }).catch((refreshError: unknown) => {
      logger.error('batch delete post-refresh failed', refreshError)
    })
    return results
  }, [refreshAssets, sessions])

  const disconnect = useCallback(async (terminalId: string) => {
    try {
      markIntentionalDisconnect(terminalId)
      await TerminalService.Close(terminalId)
      useAppStore.getState().setConnectionStatus(terminalId, 'disconnected')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('disconnect error', err)
      toast(t('断开连接失败: ${}', msg), 'error')
    }
  }, [])
  const reconnect = useCallback((tabId: string) => reconnectSessionTab(tabId, sessions), [sessions])

  return {
    connect,
    batchConnect,
    batchExecuteMacro,
    batchDeleteSessions,
    reconnect,
    disconnect,
  }
}
