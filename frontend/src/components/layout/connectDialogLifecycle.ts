import { useEffect, useRef } from 'react'
import { focusOpenedTerminal } from '@/hooks/sessionConnectionActionHooks'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'
import { useConnectDialog } from '@/store/connectDialog'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'

export const CONNECT_SUCCESS_DELAY_MS = 800
type ConnectDialogModel = ReturnType<typeof useConnectDialog.getState>

export function useConnectDialogLifecycle(dialog: ConnectDialogModel, hasPrompt: boolean) {
  const completed = useRef(false)
  useEffect(() => {
    if (dialog.open || hasPrompt) completed.current = dialog.state === 'connected' && !hasPrompt
  }, [dialog.open, dialog.state, hasPrompt])
  useEffect(() => {
    if (!dialog.open || dialog.state !== 'connected' || hasPrompt) return
    const timer = window.setTimeout(() => finishConnectionDialog(dialog.dialogId), CONNECT_SUCCESS_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [dialog.open, dialog.state, dialog.dialogId, hasPrompt])
  return {
    finish: () => finishConnectionDialog(dialog.dialogId),
    finalFocus: () => !completed.current,
  }
}

function finishConnectionDialog(dialogId: number) {
  const dialog = useConnectDialog.getState()
  if (dialog.dialogId !== dialogId || dialog.state !== 'connected' || useHostKeyPromptDialog.getState().active) return
  const { activeSurface, activePaneId, tabs } = useAppStore.getState()
  const tab = tabs.find((item) => activeSurface?.type === 'terminal' && item.id === activeSurface.id)
  dialog.closeDialog(dialogId)
  if (tab?.type === 'terminal') {
    const terminalId = activePaneId && tab.splitPaneIDs?.includes(activePaneId) ? activePaneId : tab.terminalId
    void focusOpenedTerminal(terminalId).catch((error: unknown) => logger.error('focus connected terminal failed', error))
  }
}
