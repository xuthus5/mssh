import { useEffect, useCallback, useState, lazy, Suspense } from 'react'
import { Dialogs, Events } from '@wailsio/runtime'
import { Terminal, Shield, FileText, Keyboard } from 'lucide-react'
import Sidebar from '@/components/layout/Sidebar'
import TabBar from '@/components/layout/TabBar'
import StatusBar from '@/components/layout/StatusBar'
import { ToastContainer } from '@/components/ui/toast'
import { ConnectDialog } from '@/components/layout/ConnectDialog'
import { useAppStore } from '@/store/appStore'
import { useFileTransfer } from '@/hooks/useFileTransfer'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { Spinner } from '@/components/ui/spinner'
import { WindowTitleBar } from '@/components/layout/WindowTitleBar'
import { SessionWorkspaceProvider } from '@/hooks/SessionWorkspaceContext'
import { SessionAssetCenter } from '@/components/session/SessionAssetCenter'
import { closeTabsWithFeedback } from '@/lib/closeTabsWithFeedback'

const TerminalTab = lazy(() => import('@/components/terminal/TerminalTab').then((module) => ({ default: module.TerminalTab })))
const PlaybackTab = lazy(() => import('@/components/terminal/PlaybackTab').then((module) => ({ default: module.PlaybackTab })))
const FilePanel = lazy(() => import('@/components/file/FilePanel'))

export function WelcomeScreen() {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center bg-background gap-6 select-none">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-3">
          <Terminal className="h-10 w-10 text-primary" />
          <span className="text-4xl font-bold tracking-tight text-foreground">
            MSSH
          </span>
        </div>
        <span className="text-sm text-muted-foreground">
          Secure Shell Client & Session Manager
        </span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="text-sm text-muted-foreground">
          双击会话列表中的主机开始连接
        </span>
        <span className="text-xs text-muted-foreground/60">
          或使用侧边栏新建会话
        </span>
      </div>

      <div className="flex flex-col items-center gap-2 mt-4 px-6 py-4 rounded-lg border border-border bg-card/50">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Keyboard className="h-3 w-3" />
          快捷键
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">Ctrl+N</span>
          <span className="text-foreground/70">新建会话</span>
          <span className="text-muted-foreground">Ctrl+W</span>
          <span className="text-foreground/70">关闭标签页</span>
          <span className="text-muted-foreground">Ctrl+Shift+C</span>
          <span className="text-foreground/70">复制</span>
          <span className="text-muted-foreground">Ctrl+Shift+V</span>
          <span className="text-foreground/70">粘贴</span>
          <span className="text-muted-foreground">Ctrl+Shift+L</span>
          <span className="text-foreground/70">清屏</span>
        </div>
      </div>

      <div className="flex gap-8 mt-2">
        <div className="flex flex-col items-center gap-1">
          <Terminal className="h-5 w-5 text-muted-foreground/50" />
          <span className="text-[11px] text-muted-foreground/50">多标签终端</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <FileText className="h-5 w-5 text-muted-foreground/50" />
          <span className="text-[11px] text-muted-foreground/50">会话录制</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Shield className="h-5 w-5 text-muted-foreground/50" />
          <span className="text-[11px] text-muted-foreground/50">密钥管理</span>
        </div>
      </div>
    </div>
  )
}

export function EmptyWorkspace({ entered, workspace }: { entered: boolean; workspace: 'sessions' | 'macros' }) {
  if (!entered) return <WelcomeScreen />
  return workspace === 'sessions' ? <SessionAssetCenter /> : <div aria-label="宏工作区" className="flex-1 bg-background" />
}

function FilePanelContainer({
  sessionId,
  onClose,
}: {
  sessionId: number
  onClose: () => void
}) {
  const ft = useFileTransfer(sessionId)
  const dropTargetId = `sftp-drop-zone-${sessionId}`

  useEffect(() => {
    ft.listFiles('/')
  }, [sessionId])

  useEffect(() => Events.On('sftp:files-dropped', (event: { data?: { files?: string[]; details?: { id?: string } } }) => {
    const files = event.data?.files ?? []
    const targetID = event.data?.details?.id
    if (files.length === 0 || (targetID && targetID !== dropTargetId)) return
    void ft.uploadMany(files, ft.currentPath)
  }), [dropTargetId, ft.currentPath, ft.uploadMany])

  const handleUploadClick = async () => {
    const selected = await Dialogs.OpenFile({
      Title: '选择要上传的文件',
      CanChooseFiles: true,
      CanChooseDirectories: false,
      AllowsMultipleSelection: false,
    })
    const localPath = typeof selected === 'string' ? selected : selected[0]
    if (localPath) await ft.upload(localPath, ft.currentPath)
  }

  const handleDownload = async (remotePath: string) => {
    const localPath = await Dialogs.SaveFile({
      Title: '选择下载位置',
      Filename: remotePath.split('/').pop() ?? 'download',
      CanCreateDirectories: true,
    })
    if (localPath) await ft.download(remotePath, localPath)
  }

  return (
    <Suspense fallback={<div className="w-[340px] grid place-items-center border-l"><Spinner /></div>}><FilePanel
        open
        onClose={onClose}
        files={ft.files}
        currentPath={ft.currentPath}
        loading={ft.loading}
        error={ft.error}
        onNavigateTo={ft.navigateTo}
        onNavigateUp={ft.navigateUp}
        onDelete={ft.deleteFile}
        onRename={ft.renameFile}
        onMakeDir={ft.makeDir}
        onUpload={handleUploadClick}
        onDownload={(path) => { void handleDownload(path) }}
        dropTargetId={dropTargetId}
      /></Suspense>
  )
}

function TabContent() {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const [filePanelSessionId, setFilePanelSessionId] = useState<number | null>(null)
  const hasEnteredWorkspace = useAppStore((state) => state.hasEnteredWorkspace)
  const workspace = useAppStore((state) => state.sidebarTab)

  logger.debug('App: activeTab', activeTab?.type ?? 'none', activeTabId ?? 'none')

  const handleOpenFiles = useCallback(() => {
    if (activeTab?.sessionId) {
      setFilePanelSessionId((prev) => (prev === activeTab.sessionId ? null : activeTab.sessionId!))
    }
  }, [activeTab?.sessionId])

  if (!activeTab) {
    return <EmptyWorkspace entered={hasEnteredWorkspace} workspace={workspace} />
  }

  return (
    <div className="flex-1 min-h-0 relative">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        if (tab.type === 'terminal') {
          return (
            <div key={tab.id} className={active ? 'absolute inset-0 flex' : 'absolute inset-0 hidden'}>
              <div className="flex-1 flex flex-col min-w-0">
                <TerminalTab
                  terminalID={tab.terminalId ?? tab.id}
                  sessionId={tab.sessionId ?? 0}
                  onOpenFiles={handleOpenFiles}
                  active={active}
                />
              </div>
              {active && filePanelSessionId !== null && (
                <FilePanelContainer sessionId={filePanelSessionId} onClose={() => setFilePanelSessionId(null)} />
              )}
            </div>
          )
        }
        if (!active) return null
        if (tab.type === 'playback') {
          return <PlaybackTab key={tab.id} recordingId={tab.terminalId ?? tab.id} title={tab.title} />
        }
        return (
          <div key={tab.id} className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">设置</p>
          </div>
        )
      })}
    </div>
  )
}

export default function App() {
  const hasEnteredWorkspace = useAppStore((state) => state.hasEnteredWorkspace)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const state = useAppStore.getState()
      const target = e.target as HTMLElement | null
      const editable = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false
      const commandKey = e.ctrlKey || e.metaKey

      if (editable) return

      if (commandKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('mssh:new-session'))
      }

      if (commandKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
        if (activeTab) {
            const entry = state.terminalPool.get(state.activePaneId ?? activeTab.terminalId ?? activeTab.id)
          if (entry) {
            const sel = entry.terminal.getSelection()
            if (sel) {
              navigator.clipboard.writeText(sel).catch((err: unknown) => toast(`复制失败: ${err instanceof Error ? err.message : String(err)}`, 'error'))
              logger.debug('Shortcut: Ctrl+Shift+C: copied selection')
            }
          }
        }
      }

      if (commandKey && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
        if (activeTab) {
            const entry = state.terminalPool.get(state.activePaneId ?? activeTab.terminalId ?? activeTab.id)
          if (entry) {
            navigator.clipboard.readText().then((text) => {
              entry.terminal.paste(text)
              logger.debug('Shortcut: Ctrl+Shift+V: pasted')
            }).catch((err: unknown) => toast(`粘贴失败: ${err instanceof Error ? err.message : String(err)}`, 'error'))
          }
        }
      }

      if (commandKey && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
        if (activeTab) {
            const entry = state.terminalPool.get(state.activePaneId ?? activeTab.terminalId ?? activeTab.id)
          if (entry) {
            entry.terminal.clear()
            logger.debug('Shortcut: Ctrl+Shift+L: cleared')
          }
        }
      }

      if (commandKey && !e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        if (state.activeTabId) {
          const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)
          if (activeTab?.terminalId && (state.connectionStatus[activeTab.terminalId] === 'connected' || state.recordingState[activeTab.terminalId] === 'recording')) {
            toast('请使用标签关闭按钮确认终止活动连接', 'warning')
          } else {
            closeTabsWithFeedback([state.activeTabId], state.closeTab)
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="flex flex-col h-screen w-screen bg-background">
      <WindowTitleBar />
      <SessionWorkspaceProvider><div className="flex flex-1 min-h-0">
        <div className={hasEnteredWorkspace ? 'contents' : 'hidden'}><Sidebar /></div>
        <main className="flex-1 flex flex-col min-w-0">
          {hasEnteredWorkspace && <TabBar />}
      <Suspense fallback={<div className="flex-1 grid place-items-center"><Spinner /></div>}><TabContent /></Suspense>
        </main>
      </div></SessionWorkspaceProvider>
      <StatusBar />
      <ToastContainer />
      <ConnectDialog />
    </div>
  )
}
