import { useEffect } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import StatusBar from '@/components/layout/StatusBar'
import { ToastContainer, toast } from '@/components/ui/toast'
import { ConnectDialog } from '@/components/layout/ConnectDialog'
import { useAppStore, type AppState, type Tab } from '@/store/appStore'
import { logger } from '@/lib/logger'
import { WindowTitleBar } from '@/components/layout/WindowTitleBar'
import { SessionWorkspaceProvider } from '@/hooks/SessionWorkspaceContext'
import { closeTabsWithFeedback } from '@/lib/closeTabsWithFeedback'
import { WorkspaceContent } from '@/components/layout/WorkspaceContent'
import { TerminalLayers } from '@/components/terminal/TerminalLayers'
import { SessionQuickSearchHost } from '@/components/session/SessionQuickSearchHost'
import { SESSION_QUICK_SEARCH_EVENT } from '@/lib/sessionQuickSearch'
import { GeneralSettingsRuntime } from '@/components/layout/GeneralSettingsRuntime'
import { WorkspacePersistence } from '@/components/layout/WorkspacePersistence'

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
  navigator.clipboard.writeText(selection)
    .then(() => logger.debug('Shortcut: Ctrl+Shift+C: copied selection'))
    .catch((error: unknown) => toast(`复制失败: ${error instanceof Error ? error.message : String(error)}`, 'error'))
}

function pasteClipboard(state: AppState) {
  const entry = activeTerminalEntry(state)
  if (!entry) return
  navigator.clipboard.readText()
    .then((text) => { entry.terminal.paste(text); logger.debug('Shortcut: Ctrl+Shift+V: pasted') })
    .catch((error: unknown) => toast(`粘贴失败: ${error instanceof Error ? error.message : String(error)}`, 'error'))
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
    toast('请使用标签关闭按钮确认终止活动连接', 'warning')
    return
  }
  closeTabsWithFeedback([tab.id], state.closeTab)
}

function isOrdinaryEditable(target: HTMLElement | null) {
  if (!target?.matches('input, textarea, select, [contenteditable="true"]')) return false
  if (target.classList.contains('xterm-helper-textarea')) return false
  return !target.hasAttribute('data-session-search-input')
}

function handleShortcut(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const commandKey = event.ctrlKey || event.metaKey
  if (!commandKey) return
  const key = event.key.toLowerCase()
  if (!event.shiftKey && key === 'f') {
    if (isOrdinaryEditable(target)) return
    window.dispatchEvent(new CustomEvent(SESSION_QUICK_SEARCH_EVENT))
    event.preventDefault()
    return
  }
  if (isOrdinaryEditable(target)) return
  const state = useAppStore.getState()

  if (!event.shiftKey && key === 'n') window.dispatchEvent(new CustomEvent('mssh:new-session'))
  else if (!event.shiftKey && key === 'w') closeActiveTab(state)
  else if (event.shiftKey && key === 'c') copySelection(state)
  else if (event.shiftKey && key === 'v') pasteClipboard(state)
  else if (event.shiftKey && key === 'l') clearTerminal(state)
  else return
  event.preventDefault()
}

export default function App() {
  const activeSurface = useAppStore((state) => state.activeSurface)

  useEffect(() => {
    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col bg-background">
      <SessionWorkspaceProvider>
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
      </SessionWorkspaceProvider>
    </div>
  )
}
