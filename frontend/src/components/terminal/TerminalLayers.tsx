import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Dialogs, Events } from '@wailsio/runtime'
import { Spinner } from '@/components/ui/spinner'
import { TerminalErrorBoundary } from '@/components/terminal/TerminalErrorBoundary'
import { useFileTransfer } from '@/hooks/useFileTransfer'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { closeTabsWithFeedback } from '@/lib/closeTabsWithFeedback'
import { useAppStore, type AppState, type Tab } from '@/store/appStore'

const TerminalTab = lazy(() => import('@/components/terminal/TerminalTab').then((module) => ({ default: module.TerminalTab })))
const PlaybackTab = lazy(() => import('@/components/terminal/PlaybackTab').then((module) => ({ default: module.PlaybackTab })))
const FilePanel = lazy(() => import('@/components/file/FilePanel'))

type FileTransfer = ReturnType<typeof useFileTransfer>
const noFocusRequest: TerminalFocusRequest = { sequence: 0 }

function FilePanelView({ transfer, onClose, onUpload, onDownload, dropTargetID }: {
  transfer: FileTransfer
  onClose: () => void
  onUpload: () => void
  onDownload: (path: string) => void
  dropTargetID: string
}) {
  return (
    <Suspense fallback={<div className="grid w-[340px] place-items-center border-l"><Spinner /></div>}>
      <FilePanel open onClose={onClose} files={transfer.files} currentPath={transfer.currentPath}
        loading={transfer.loading} error={transfer.error} onNavigateTo={transfer.navigateTo}
        onNavigateUp={transfer.navigateUp} onDelete={transfer.deleteFile} onRename={transfer.renameFile}
        onMakeDir={transfer.makeDir} onUpload={onUpload} onDownload={onDownload} dropTargetId={dropTargetID} />
    </Suspense>
  )
}

function FilePanelContainer({ sessionID, onClose }: { sessionID: number; onClose: () => void }) {
  const transfer = useFileTransfer(sessionID)
  const dropTargetID = `sftp-drop-zone-${sessionID}`

  useEffect(() => { void transfer.listFiles('/') }, [transfer.listFiles])
  useEffect(() => Events.On('sftp:files-dropped', (event: { data?: { files?: string[]; details?: { id?: string } } }) => {
    const files = event.data?.files ?? []
    const targetID = event.data?.details?.id
    if (files.length === 0 || (targetID && targetID !== dropTargetID)) return
    void transfer.uploadMany(files, transfer.currentPath)
  }), [dropTargetID, transfer.currentPath, transfer.uploadMany])

  const handleUpload = useCallback(async () => {
    const selected = await Dialogs.OpenFile({ Title: '选择要上传的文件', CanChooseFiles: true, CanChooseDirectories: false, AllowsMultipleSelection: false })
    const localPath = typeof selected === 'string' ? selected : selected[0]
    if (localPath) await transfer.upload(localPath, transfer.currentPath)
  }, [transfer.currentPath, transfer.upload])

  const handleDownload = useCallback(async (remotePath: string) => {
    const localPath = await Dialogs.SaveFile({ Title: '选择下载位置', Filename: remotePath.split('/').pop() ?? 'download', CanCreateDirectories: true })
    if (localPath) await transfer.download(remotePath, localPath)
  }, [transfer.download])

  return <FilePanelView transfer={transfer} onClose={onClose} onUpload={() => { void handleUpload() }}
    onDownload={(path) => { void handleDownload(path) }} dropTargetID={dropTargetID} />
}

function DynamicLayer({ tab, active, filePanelSessionID, onToggleFiles, onCloseFiles, focusRequest, onClose }: {
  tab: Tab
  active: boolean
  filePanelSessionID: number | null
  onToggleFiles: (sessionID: number) => void
  onCloseFiles: () => void
  focusRequest: AppState['focusRequest']
  onClose: () => void
}) {
  const layerClass = `absolute inset-0 flex ${active ? 'visible' : 'invisible pointer-events-none'}`
  const terminalFocusRequest = focusRequest.id === tab.id ? focusRequest : noFocusRequest
  return (
    <div data-layer-id={tab.id} aria-hidden={!active} inert={active ? undefined : true} className={layerClass}>
      <TerminalErrorBoundary onClose={onClose}>
        {tab.type === 'terminal' ? <>
          <div className="flex min-w-0 flex-1 flex-col">
            <TerminalTab terminalID={tab.terminalId ?? tab.id} sessionId={tab.sessionId ?? 0}
              onOpenFiles={() => onToggleFiles(tab.sessionId ?? 0)} active={active} focusRequest={terminalFocusRequest} />
          </div>
          {active && tab.sessionId === filePanelSessionID
            ? <FilePanelContainer sessionID={filePanelSessionID} onClose={onCloseFiles} />
            : null}
        </> : <PlaybackTab recordingId={tab.terminalId ?? tab.id} title={tab.title} active={active} />}
      </TerminalErrorBoundary>
    </div>
  )
}

export function TerminalLayers() {
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const focusRequest = useAppStore((state) => state.focusRequest)
  const closeTab = useAppStore((state) => state.closeTab)
  const [filePanelSessionID, setFilePanelSessionID] = useState<number | null>(null)

  const toggleFiles = useCallback((sessionID: number) => {
    if (sessionID === 0) return
    setFilePanelSessionID((current) => current === sessionID ? null : sessionID)
  }, [])

  return <>{tabs.map((tab) => <DynamicLayer key={tab.id} tab={tab}
    active={activeSurface?.type === tab.type && activeSurface.id === tab.id}
    filePanelSessionID={filePanelSessionID} onToggleFiles={toggleFiles}
    focusRequest={focusRequest} onCloseFiles={() => setFilePanelSessionID(null)}
    onClose={() => closeTabsWithFeedback([tab.id], closeTab)} />)}</>
}
