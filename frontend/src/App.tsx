import { useEffect, useCallback, useState, useRef } from 'react'
import { Terminal, Shield, FileText, Keyboard } from 'lucide-react'
import Sidebar from '@/components/layout/Sidebar'
import TabBar from '@/components/layout/TabBar'
import StatusBar from '@/components/layout/StatusBar'
import { TerminalTab } from '@/components/terminal/TerminalTab'
import { PlaybackTab } from '@/components/terminal/PlaybackTab'
import FilePanel from '@/components/file/FilePanel'
import { ToastContainer } from '@/components/ui/toast'
import { ConnectDialog } from '@/components/layout/ConnectDialog'
import { useAppStore } from '@/store/appStore'
import { useFileTransfer } from '@/hooks/useFileTransfer'

function WelcomeScreen() {
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

function FilePanelContainer({
  sessionId,
  onClose,
}: {
  sessionId: number
  onClose: () => void
}) {
  const ft = useFileTransfer(sessionId)
  const [downloadPath, setDownloadPath] = useState('')
  const [showDownloadInput, setShowDownloadInput] = useState(false)
  const [pendingDownload, setPendingDownload] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ft.listFiles('/')
  }, [sessionId])

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      ft.upload(file.name, ft.currentPath)
      e.target.value = ''
    }
  }

  const handleDownload = (path: string) => {
    setPendingDownload(path)
    setShowDownloadInput(true)
  }

  const handleConfirmDownload = () => {
    if (pendingDownload && downloadPath.trim()) {
      ft.download(pendingDownload, downloadPath.trim())
      setPendingDownload(null)
      setDownloadPath('')
      setShowDownloadInput(false)
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelected}
      />
      <FilePanel
        open
        onClose={onClose}
        files={ft.files}
        currentPath={ft.currentPath}
        loading={ft.loading}
        onNavigateTo={ft.navigateTo}
        onNavigateUp={ft.navigateUp}
        onDelete={ft.deleteFile}
        onRename={ft.renameFile}
        onMakeDir={ft.makeDir}
        onUpload={handleUploadClick}
        onDownload={handleDownload}
      />
      {showDownloadInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-lg border border-border p-4 w-80 flex flex-col gap-3">
            <span className="text-sm font-medium">下载文件</span>
            <span className="text-xs text-muted-foreground truncate">
              远程文件: {pendingDownload}
            </span>
            <input
              className="h-8 px-2 text-sm rounded border border-input bg-background outline-none"
              placeholder="本地保存路径"
              value={downloadPath}
              onChange={(e) => setDownloadPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmDownload()
                if (e.key === 'Escape') setShowDownloadInput(false)
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted"
                onClick={() => setShowDownloadInput(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleConfirmDownload}
              >
                下载
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function TabContent() {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const [filePanelSessionId, setFilePanelSessionId] = useState<number | null>(null)

  console.log('[App] activeTab', activeTab?.type ?? 'none', activeTabId ?? 'none')

  const handleOpenFiles = useCallback(() => {
    if (activeTab?.sessionId) {
      setFilePanelSessionId((prev) => (prev === activeTab.sessionId ? null : activeTab.sessionId!))
    }
  }, [activeTab?.sessionId])

  if (!activeTab) {
    return <WelcomeScreen />
  }

  switch (activeTab.type) {
    case 'terminal':
      return (
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 flex flex-col min-w-0">
            <TerminalTab
              terminalID={activeTab.terminalId ?? activeTab.id}
              sessionId={activeTab.sessionId ?? 0}
              onOpenFiles={handleOpenFiles}
            />
          </div>
          {filePanelSessionId !== null && (
            <FilePanelContainer
              sessionId={filePanelSessionId}
              onClose={() => setFilePanelSessionId(null)}
            />
          )}
        </div>
      )
    case 'playback':
      return (
        <PlaybackTab
          recordingId={activeTab.terminalId ?? activeTab.id}
          title={activeTab.title}
        />
      )
    case 'settings':
      return (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">设置</p>
        </div>
      )
    default:
      return null
  }
}

export default function App() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const state = useAppStore.getState()

      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault()
        const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
        if (activeTab) {
          const entry = state.terminalPool.get(activeTab.terminalId ?? activeTab.id)
          if (entry) {
            const sel = entry.terminal.getSelection()
            if (sel) {
              navigator.clipboard.writeText(sel).catch(() => {})
              console.log('[Shortcut] Ctrl+Shift+C: copied selection')
            }
          }
        }
      }

      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault()
        const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
        if (activeTab) {
          const entry = state.terminalPool.get(activeTab.terminalId ?? activeTab.id)
          if (entry) {
            navigator.clipboard.readText().then((text) => {
              entry.terminal.paste(text)
              console.log('[Shortcut] Ctrl+Shift+V: pasted')
            }).catch(() => {})
          }
        }
      }

      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault()
        const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
        if (activeTab) {
          const entry = state.terminalPool.get(activeTab.terminalId ?? activeTab.id)
          if (entry) {
            entry.terminal.clear()
            console.log('[Shortcut] Ctrl+Shift+L: cleared')
          }
        }
      }

      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        if (state.activeTabId) {
          console.log('[Shortcut] Ctrl+W: close tab', state.activeTabId)
          state.closeTab(state.activeTabId)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="flex flex-col h-screen w-screen bg-background">
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <TabBar />
          <TabContent />
        </main>
      </div>
      <StatusBar />
      <ToastContainer />
      <ConnectDialog />
    </div>
  )
}
