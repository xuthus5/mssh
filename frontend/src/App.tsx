import { useEffect } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import StatusBar from '@/components/layout/StatusBar'
import { ToastContainer, toast } from '@/components/ui/toast'
import { ConnectDialog } from '@/components/layout/ConnectDialog'
import { useAppStore, type AppState, type Tab } from '@/store/appStore'
import { logger } from '@/lib/logger'
import { WindowTitleBar } from '@/components/layout/WindowTitleBar'
import { SessionWorkspaceProvider, useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { closeTabsWithFeedback } from '@/lib/closeTabsWithFeedback'
import { WorkspaceContent } from '@/components/layout/WorkspaceContent'
import { TerminalLayers } from '@/components/terminal/TerminalLayers'
import { SessionQuickSearchHost } from '@/components/session/SessionQuickSearchHost'
import { SESSION_QUICK_SEARCH_EVENT } from '@/lib/sessionQuickSearch'
import { APP_NEW_LOCAL_TERMINAL_EVENT, APP_NEW_SESSION_EVENT, emitAppEvent, onAppEvent } from '@/lib/appEvents'
import { openLocalTerminal } from '@/lib/openLocalTerminal'
import { GeneralSettingsRuntime } from '@/components/layout/GeneralSettingsRuntime'
import { WorkspacePersistence } from '@/components/layout/WorkspacePersistence'
import { createAppSyncDataReload, hotReloadSessionWorkspace, registerSyncDataReload } from '@/lib/syncDataReload'
import { getClipboard } from '@/lib/clipboard'
import { t } from '@/i18n'
import { VaultGate } from '@/components/security/VaultGate'
import { useShortcutStore } from '@/store/shortcutStore'
import { useShortcutRuntimeHydration } from '@/hooks/useShortcutSettings'
import { resolveShortcutAction } from '@/lib/shortcutRuntime'
import type { ShortcutActionId } from '@/lib/shortcuts'


function activeTab(state: AppState): Tab | undefined {
  const surface = state.activeSurface
  if (!surface || surface.type === 'workspace') return undefined
  return state.tabs.find((tab) => tab.id === surface.id)
}

function activeTerminalEntry(state: AppState) {
  if (state.activeSurface?.type !== 'terminal') return undefined
  const tab = activeTab(state)
  if (!tab || tab.type !== 'terminal') return undefined
  return state.terminalPool.get(state.activePaneId ?? tab.terminalId)
}

function copySelection(state: AppState) {
  const selection = activeTerminalEntry(state)?.terminal.getSelection()
  if (!selection) return
  getClipboard().writeText(selection)
    .then(() => logger.debug('Shortcut: Ctrl+Shift+C: copied selection'))
    .catch((error: unknown) => toast(t('复制失败: ${}', error instanceof Error ? error.message : String(error)), 'error'))
}

function pasteClipboard(state: AppState) {
  const entry = activeTerminalEntry(state)
  if (!entry) return
  getClipboard().readText()
    .then((text) => { entry.terminal.paste(text); logger.debug('Shortcut: Ctrl+Shift+V: pasted') })
    .catch((error: unknown) => toast(t('粘贴失败: ${}', error instanceof Error ? error.message : String(error)), 'error'))
}

function clearTerminal(state: AppState) {
  const entry = activeTerminalEntry(state)
  if (!entry) return
  entry.terminal.clear()
  logger.debug('Shortcut: Ctrl+Shift+L: cleared')
}

function closeActiveTab(state: AppState) {
  const tab = activeTab(state)
  if (!tab) return
  if (tab.type === 'terminal' && (state.connectionStatus[tab.terminalId] === 'connected' || state.recordingState[tab.terminalId] === 'recording')) {
    toast(t('请使用标签关闭按钮确认终止活动连接'), 'warning')
    return
  }
  closeTabsWithFeedback([tab.id], state.closeTab)
}


function runShortcutAction(actionId: ShortcutActionId) {
  const state = useAppStore.getState()
  switch (actionId) {
    case 'new-session':
      emitAppEvent(APP_NEW_SESSION_EVENT)
      return
    case 'new-local-terminal':
      emitAppEvent(APP_NEW_LOCAL_TERMINAL_EVENT)
      return
    case 'close-tab':
      closeActiveTab(state)
      return
    case 'quick-search':
      emitAppEvent(SESSION_QUICK_SEARCH_EVENT)
      return
    case 'copy-selection':
      copySelection(state)
      return
    case 'paste-clipboard':
      pasteClipboard(state)
      return
    case 'clear-terminal':
      clearTerminal(state)
      return
  }
}

function handleShortcut(event: KeyboardEvent) {
  const bindings = useShortcutStore.getState().bindings
  const actionId = resolveShortcutAction(event, bindings)
  if (!actionId) return
  event.preventDefault()
  runShortcutAction(actionId)
}

function AppShell() {
  const activeSurface = useAppStore((state) => state.activeSurface)
  const workspace = useSessionWorkspace()
  useShortcutRuntimeHydration()

  useEffect(() => {
    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => onAppEvent(APP_NEW_LOCAL_TERMINAL_EVENT, () => {
    void openLocalTerminal().catch((error: unknown) => {
      toast(t('打开本地终端失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    })
  }), [])

  useEffect(() => registerSyncDataReload(createAppSyncDataReload({
    hotReload: () => hotReloadSessionWorkspace(workspace),
  })), [workspace])

  return (
    <>
      <GeneralSettingsRuntime />
      <WorkspacePersistence />
      <WindowTitleBar />
      <div className="flex min-h-0 flex-1">
        <div className={activeSurface === null ? 'hidden' : 'contents'}><Sidebar /></div>
        <main className="relative flex min-w-0 flex-1 flex-col">
          <WorkspaceContent />
          <TerminalLayers />
        </main>
      </div>
      <StatusBar />
      <ToastContainer />
      <ConnectDialog />
      <SessionQuickSearchHost />
    </>
  )
}

export default function App() {
  return (
    <VaultGate>
      <div className="flex h-screen w-screen flex-col bg-background">
        <SessionWorkspaceProvider>
          <AppShell />
        </SessionWorkspaceProvider>
      </div>
    </VaultGate>
  )
}
