import { useCallback, useEffect, useRef, useState } from 'react'
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

function useCloseLifecycle() {
  const lifecycle = useRef(0)
  const closeRequest = useRef(0)
  const closingRef = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current !== token) return
      lifecycle.current++
      closeRequest.current++
      closingRef.current = false
    }
  }, [])
  return { lifecycle, closeRequest, closingRef }
}

function useConfirmedClose(options: {
  pendingTabID: string | null
  closeTab: AppState['closeTab']
  setPendingTabID: (value: string | null) => void
  setCloseError: (value: string) => void
  setClosing: (value: boolean) => void
  runtime: ReturnType<typeof useCloseLifecycle>
}) {
  return useCallback(() => {
    const { pendingTabID, closeTab, setPendingTabID, setCloseError, setClosing, runtime } = options
    if (!pendingTabID || runtime.closingRef.current) return
    const lifecycleToken = runtime.lifecycle.current
    const request = ++runtime.closeRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken && runtime.closeRequest.current === request
    runtime.closingRef.current = true
    setClosing(true)
    setCloseError('')
    void closeTab(pendingTabID).then(() => {
      if (!isCurrent()) return
      setPendingTabID(null)
      setCloseError('')
    }).catch((error: unknown) => {
      if (!isCurrent()) return
      logger.error('close tab failed', { tabId: pendingTabID, error })
      setCloseError(t('关闭标签失败: ${}', error instanceof Error ? error.message : String(error)))
    }).finally(() => {
      if (runtime.closeRequest.current === request) runtime.closingRef.current = false
      if (isCurrent()) setClosing(false)
    })
  }, [options])
}

export function useTabCloseCoordinator() {
  const tabs = useAppStore((state) => state.tabs)
  const closeTab = useAppStore((state) => state.closeTab)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const recordingState = useAppStore((state) => state.recordingState)
  const [pendingTabID, setPendingTabID] = useState<string | null>(null)
  const [closeError, setCloseError] = useState('')
  const [closing, setClosing] = useState(false)
  const runtime = useCloseLifecycle()

  const requestClose = useCallback((tabID: string) => {
    if (runtime.closingRef.current) return
    const tab = tabs.find((item) => item.id === tabID)
    if (tab && requiresCloseConfirmation(tab, connectionStatus, recordingState)) {
      setCloseError('')
      setPendingTabID(tabID)
      return
    }
    // Unconfirmed closes have no dialog surface; app-shell banner owns failures.
    closeTabsWithFeedback([tabID], closeTab)
  }, [closeTab, connectionStatus, recordingState, runtime.closingRef, tabs])
  const confirmClose = useConfirmedClose({
    pendingTabID, closeTab, setPendingTabID, setCloseError, setClosing, runtime,
  })

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
          <AlertDialogAction variant="destructive" disabled={closing} onClick={(event) => { event.preventDefault(); onConfirm() }}>
            {closing ? t('关闭中…') : t('关闭连接')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
