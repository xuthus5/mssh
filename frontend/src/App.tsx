import { useEffect } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import StatusBar from '@/components/layout/StatusBar'
import { ToastContainer, toast } from '@/components/ui/toast'
import { ConnectDialog } from '@/components/layout/ConnectDialog'
import { HostKeyPromptDialog } from '@/components/layout/HostKeyPromptDialog'
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
import { WorkspacePersistence, WorkspaceRestoreBanner } from '@/components/layout/WorkspacePersistence'
import { createAppSyncDataReload, hotReloadSessionWorkspace, registerSyncDataReload } from '@/lib/syncDataReload'
import { getClipboard } from '@/lib/clipboard'
import { reportTerminalClipboardError } from '@/lib/terminalClipboardEvents'
import { t } from '@/i18n'
import { VaultGate } from '@/components/security/VaultGate'
import { ConfirmDialogHost } from '@/components/confirm/ConfirmDialogHost'
import { useShortcutStore } from '@/store/shortcutStore'
import { useShortcutRuntimeHydration } from '@/hooks/useShortcutSettings'
import { resolveShortcutAction } from '@/lib/shortcutRuntime'
import type { ShortcutActionId } from '@/lib/shortcuts'
import { emitTerminalSearchToggle } from '@/lib/terminalSearchEvents'
import { resolveQuickSearchTarget } from '@/lib/quickSearchRouting'
import { AIAgentTaskCenter } from '@/components/agent/AIAgentTaskCenter'


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

function activeTerminalID(state: AppState): string | null {
  if (state.activePaneId) return state.activePaneId
  const tab = activeTab(state)
  return tab?.type === 'terminal' ? tab.terminalId : null
}

function terminalEntryIsCurrent(terminalID: string | null, entry: NonNullable<ReturnType<typeof activeTerminalEntry>>): boolean {
  if (!terminalID) return false
  return useAppStore.getState().terminalPool.get(terminalID)?.terminal === entry.terminal
}

function copySelection(state: AppState): boolean {
  const entry = activeTerminalEntry(state)
  if (!entry) return false
  const selection = entry.terminal.getSelection()
  if (!selection) return false
  const terminalID = activeTerminalID(state)
  getClipboard().writeText(selection)
    .then(() => logger.debug('Shortcut: Ctrl+Shift+C: copied selection'))
    .catch((error: unknown) => {
      if (!terminalEntryIsCurrent(terminalID, entry)) return
      logger.error('shortcut copy failed', error)
      reportTerminalClipboardError(
        t('复制失败: ${}', error instanceof Error ? error.message : String(error)),
        terminalID,
      )
    })
  return true
}

function pasteClipboard(state: AppState) {
  const entry = activeTerminalEntry(state)
  if (!entry) return
  const terminalID = activeTerminalID(state)
  getClipboard().readText()
    .then((text) => {
      if (!terminalEntryIsCurrent(terminalID, entry)) return
      entry.terminal.paste(text)
      logger.debug('Shortcut: Ctrl+Shift+V: pasted')
    })
    .catch((error: unknown) => {
      if (!terminalEntryIsCurrent(terminalID, entry)) return
      logger.error('shortcut paste failed', error)
      reportTerminalClipboardError(
        t('粘贴失败: ${}', error instanceof Error ? error.message : String(error)),
        terminalID,
      )
    })
}

function clearTerminal(state: AppState): boolean {
  const entry = activeTerminalEntry(state)
  if (!entry) return false
  entry.terminal.clear()
  logger.debug('Shortcut: Ctrl+Shift+L: cleared')
  return true
}

function closeActiveTab(state: AppState): boolean {
  const tab = activeTab(state)
  if (!tab) return false
  if (tab.type === 'terminal' && (state.connectionStatus[tab.terminalId] === 'connected' || state.recordingState[tab.terminalId] === 'recording')) {
    toast(t('请使用标签关闭按钮确认终止活动连接'), 'warning')
    return true
  }
  closeTabsWithFeedback([tab.id], state.closeTab)
  return true
}

function runShortcutAction(actionId: ShortcutActionId): boolean {
  const state = useAppStore.getState()
  switch (actionId) {
    case 'new-session':
      emitAppEvent(APP_NEW_SESSION_EVENT)
      return true
    case 'new-local-terminal':
      emitAppEvent(APP_NEW_LOCAL_TERMINAL_EVENT)
      return true
    case 'close-tab':
      return closeActiveTab(state)
    case 'quick-search':
      // When a terminal tab is active, Mod+F opens in-terminal search; otherwise session quick search.
      if (resolveQuickSearchTarget(state.activeSurface) === 'terminal-search') {
        emitTerminalSearchToggle()
        return true
      }
      emitAppEvent(SESSION_QUICK_SEARCH_EVENT)
      return true
    case 'copy-selection':
      return copySelection(state)
    case 'paste-clipboard':
      pasteClipboard(state)
      return true
    case 'clear-terminal':
      return clearTerminal(state)
  }
}

function handleShortcut(event: KeyboardEvent) {
  const bindings = useShortcutStore.getState().bindings
  const actionId = resolveShortcutAction(event, bindings)
  if (!actionId) return
  if (!runShortcutAction(actionId)) return
  event.preventDefault()
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
      logger.error('open local terminal failed', error)
      // App shell banner owns this global action (title bar / welcome / shortcut).
      useAppStore.getState().setShellActionError(
        t('打开本地终端失败: ${}', error instanceof Error ? error.message : String(error)),
      )
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
        <main className="flex min-w-0 flex-1 flex-col">
          <WorkspaceRestoreBanner />
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <WorkspaceContent />
            <TerminalLayers />
          </div>
        </main>
      </div>
      <StatusBar />
      <ToastContainer />
      <ConfirmDialogHost />
      <ConnectDialog />
      <HostKeyPromptDialog />
      <SessionQuickSearchHost />
      <AIAgentTaskCenter />
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
