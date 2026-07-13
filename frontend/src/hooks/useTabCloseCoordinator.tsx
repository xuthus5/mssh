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
import { useAppStore, type AppState, type Tab } from '@/store/appStore'

function requiresCloseConfirmation(
  tab: Tab,
  connectionStatus: AppState['connectionStatus'],
  recordingState: AppState['recordingState'],
): boolean {
  if (!tab.terminalId) return false
  return connectionStatus[tab.terminalId] === 'connected'
    || recordingState[tab.terminalId] === 'recording'
}

export function useTabCloseCoordinator() {
  const tabs = useAppStore((state) => state.tabs)
  const closeTab = useAppStore((state) => state.closeTab)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const recordingState = useAppStore((state) => state.recordingState)
  const [pendingTabID, setPendingTabID] = useState<string | null>(null)

  const requestClose = useCallback((tabID: string) => {
    const tab = tabs.find((item) => item.id === tabID)
    if (tab && requiresCloseConfirmation(tab, connectionStatus, recordingState)) {
      setPendingTabID(tabID)
      return
    }
    closeTabsWithFeedback([tabID], closeTab)
  }, [closeTab, connectionStatus, recordingState, tabs])

  const confirmClose = useCallback(() => {
    if (pendingTabID) closeTabsWithFeedback([pendingTabID], closeTab)
    setPendingTabID(null)
  }, [closeTab, pendingTabID])

  return {
    requestClose,
    confirmation: {
      pendingTabID,
      onCancel: () => setPendingTabID(null),
      onConfirm: confirmClose,
    },
  }
}

export function TabCloseConfirmation({ pendingTabID, onCancel, onConfirm }: {
  pendingTabID: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={pendingTabID !== null} onOpenChange={(open) => { if (!open) onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>关闭活动连接？</AlertDialogTitle>
          <AlertDialogDescription>所选标签仍有活动 SSH 连接或录制任务。关闭将终止远程会话且无法恢复。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>关闭连接</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
