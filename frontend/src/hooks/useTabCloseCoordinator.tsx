import { useCallback, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { closeTabsWithFeedback } from '@/lib/closeTabsWithFeedback'
import { logger } from '@/lib/logger'
import { useAppStore, type AppState, type Tab } from '@/store/appStore'
import { t } from '@/i18n'


function requiresCloseConfirmation(
  tab: Tab,
  connectionStatus: AppState['connectionStatus'],
  recordingState: AppState['recordingState'],
): boolean {
  if (tab.type !== 'terminal') return false
  return connectionStatus[tab.terminalId] === 'connected'
    || recordingState[tab.terminalId] === 'recording'
}

export function useTabCloseCoordinator() {
  const tabs = useAppStore((state) => state.tabs)
  const closeTab = useAppStore((state) => state.closeTab)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const recordingState = useAppStore((state) => state.recordingState)
  const [pendingTabID, setPendingTabID] = useState<string | null>(null)
  const [closeError, setCloseError] = useState('')
  const [closing, setClosing] = useState(false)

  const requestClose = useCallback((tabID: string) => {
    const tab = tabs.find((item) => item.id === tabID)
    if (tab && requiresCloseConfirmation(tab, connectionStatus, recordingState)) {
      setCloseError('')
      setPendingTabID(tabID)
      return
    }
    // Unconfirmed closes have no dialog surface; app-shell banner owns failures.
    closeTabsWithFeedback([tabID], closeTab)
  }, [closeTab, connectionStatus, recordingState, tabs])

  const confirmClose = useCallback(() => {
    if (!pendingTabID || closing) return
    const tabID = pendingTabID
    setClosing(true)
    setCloseError('')
    void closeTab(tabID)
      .then(() => {
        setPendingTabID(null)
        setCloseError('')
      })
      .catch((error: unknown) => {
        logger.error('close tab failed', { tabId: tabID, error })
        const message = error instanceof Error ? error.message : String(error)
        setCloseError(t('关闭标签失败: ${}', message))
      })
      .finally(() => {
        setClosing(false)
      })
  }, [closeTab, closing, pendingTabID])

  return {
    requestClose,
    confirmation: {
      pendingTabID,
      closeError,
      closing,
      onCancel: () => {
        if (closing) return
        setPendingTabID(null)
        setCloseError('')
      },
      onConfirm: confirmClose,
    },
  }
}

export function TabCloseConfirmation({
  pendingTabID,
  closeError = '',
  closing = false,
  onCancel,
  onConfirm,
}: {
  pendingTabID: string | null
  closeError?: string
  closing?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={pendingTabID !== null} onOpenChange={(open) => { if (!open && !closing) onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('关闭活动连接？')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('所选标签仍有活动 SSH 连接或录制任务。关闭将终止远程会话且无法恢复。')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {closeError ? <p role="alert" className="text-sm text-destructive">{closeError}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={closing}>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={closing} onClick={onConfirm}>
            {closing ? t('关闭中…') : t('关闭连接')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
