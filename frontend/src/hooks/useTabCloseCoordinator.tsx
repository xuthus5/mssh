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
import { Checkbox } from '@/components/ui/checkbox'
import { closeTabsWithFeedback } from '@/lib/closeTabsWithFeedback'
import { logger } from '@/lib/logger'
import { useAppStore, type AppState, type Tab } from '@/store/appStore'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { persistTerminalClosePreference } from '@/lib/terminalClosePreference'
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
  tabs: Tab[]
  setPendingTabID: (value: string | null) => void
  setCloseError: (value: string) => void
  setClosing: (value: boolean) => void
  runtime: ReturnType<typeof useCloseLifecycle>
}) {
  return useCallback(() => {
    const { pendingTabID, closeTab, tabs, setPendingTabID, setCloseError, setClosing, runtime } = options
    if (!pendingTabID || runtime.closingRef.current) return
    const lifecycleToken = runtime.lifecycle.current
    const request = ++runtime.closeRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken && runtime.closeRequest.current === request
    const targets = pendingTabID === '__all__'
      ? tabs.filter((item) => item.type === 'terminal').map((item) => item.id)
      : [pendingTabID]
    runtime.closingRef.current = true
    setClosing(true)
    setCloseError('')
    Promise.all(targets.map((id) => closeTab(id))).then(() => {
      if (!isCurrent()) return
      setPendingTabID(null)
      setCloseError('')
    }).catch((error: unknown) => {
      if (!isCurrent()) return
      logger.error('close tabs failed', { targets, error })
      setCloseError(t('关闭标签失败: ${}', error instanceof Error ? error.message : String(error)))
    }).finally(() => {
      if (runtime.closeRequest.current === request) runtime.closingRef.current = false
      if (isCurrent()) setClosing(false)
    })
  }, [options])
}

function useCloseRequests(options: {
  tabs: Tab[]
  connectionStatus: AppState['connectionStatus']
  recordingState: AppState['recordingState']
  autoCloseTerminalOnExit: boolean
  closeTab: AppState['closeTab']
  closingRef: { current: boolean }
  setRemember: (value: boolean) => void
  setCloseError: (value: string) => void
  setPendingTabID: (value: string | null) => void
}) {
  const { tabs, connectionStatus, recordingState, autoCloseTerminalOnExit, closeTab, closingRef, setRemember, setCloseError, setPendingTabID } = options
  const requestClose = useCallback((tabID: string) => {
    if (closingRef.current) return
    const tab = tabs.find((item) => item.id === tabID)
    const needsConfirmation = tab && requiresCloseConfirmation(tab, connectionStatus, recordingState)
    if (needsConfirmation && !autoCloseTerminalOnExit) {
      setRemember(false)
      setCloseError('')
      setPendingTabID(tabID)
      return
    }
    // Unconfirmed closes have no dialog surface; app-shell banner owns failures.
    closeTabsWithFeedback([tabID], closeTab)
  }, [autoCloseTerminalOnExit, closeTab, closingRef, connectionStatus, recordingState, setCloseError, setPendingTabID, setRemember, tabs])
  const requestCloseAll = useCallback(() => {
    if (closingRef.current) return
    const terminalTabs = tabs.filter((item) => item.type === 'terminal')
    if (terminalTabs.length === 0) return
    const needsConfirmation = terminalTabs.some((tab) => requiresCloseConfirmation(tab, connectionStatus, recordingState))
    if (needsConfirmation && !autoCloseTerminalOnExit) {
      setRemember(false)
      setCloseError('')
      setPendingTabID('__all__')
      return
    }
    closeTabsWithFeedback(terminalTabs.map((tab) => tab.id), closeTab)
  }, [autoCloseTerminalOnExit, closeTab, closingRef, connectionStatus, recordingState, setCloseError, setPendingTabID, setRemember, tabs])
  return { requestClose, requestCloseAll }
}

export function useTabCloseCoordinator() {
  const tabs = useAppStore((state) => state.tabs)
  const closeTab = useAppStore((state) => state.closeTab)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const recordingState = useAppStore((state) => state.recordingState)
  const autoCloseTerminalOnExit = useTerminalBehaviorStore((state) => state.autoCloseTerminalOnExit)
  const [pendingTabID, setPendingTabID] = useState<string | null>(null)
  const [closeError, setCloseError] = useState('')
  const [closing, setClosing] = useState(false)
  const [remember, setRemember] = useState(false)
  const runtime = useCloseLifecycle()
  const { requestClose, requestCloseAll } = useCloseRequests({
    tabs, connectionStatus, recordingState, autoCloseTerminalOnExit, closeTab,
    closingRef: runtime.closingRef, setRemember, setCloseError, setPendingTabID,
  })
  const confirmClose = useConfirmedClose({
    pendingTabID, closeTab, tabs, setPendingTabID, setCloseError, setClosing, runtime,
  })
  const confirmWithPreference = useCallback(() => {
    void persistTerminalClosePreference(remember).then(() => confirmClose())
  }, [confirmClose, remember])

  return {
    requestClose,
    requestCloseAll,
    confirmation: {
      pendingTabID,
      closeError,
      closing,
      remember,
      setRemember,
      onCancel: () => {
        if (closing) return
        setPendingTabID(null)
        setCloseError('')
        setRemember(false)
      },
      onConfirm: confirmClose,
      onConfirmWithPreference: confirmWithPreference,
    },
  }
}

export function TabCloseConfirmation({
  pendingTabID,
  closeError = '',
  closing = false,
  remember = false,
  setRemember,
  onCancel,
  onConfirm,
  onConfirmWithPreference,
}: {
  pendingTabID: string | null
  closeError?: string
  closing?: boolean
  remember?: boolean
  setRemember?: (value: boolean) => void
  onCancel: () => void
  onConfirm: () => void
  onConfirmWithPreference?: () => void
}) {
  const closingAll = pendingTabID === '__all__'
  const confirmAction = onConfirmWithPreference ? onConfirmWithPreference : onConfirm
  const confirmLabel = closingAll ? t('全部关闭') : t('关闭连接')
  return (
    <AlertDialog open={pendingTabID !== null} onOpenChange={(open) => { if (!open && !closing) onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{closingAll ? t('关闭所有活动连接？') : t('关闭活动连接？')}</AlertDialogTitle>
          <AlertDialogDescription>
            {closingAll
              ? t('仍有活动 SSH 连接或录制任务。全部关闭将终止远程会话且无法恢复。')
              : t('所选标签仍有活动 SSH 连接或录制任务。关闭将终止远程会话且无法恢复。')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {closeError ? <p role="alert" className="text-sm text-destructive">{closeError}</p> : null}
        {setRemember ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />
            {t('下次不再提醒，直接关闭')}
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={closing}>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={closing} onClick={(event) => { event.preventDefault(); confirmAction() }}>
            {closing ? t('关闭中…') : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
