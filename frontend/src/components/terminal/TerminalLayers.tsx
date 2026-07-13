import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Dialogs, Events } from '@wailsio/runtime'
import { Spinner } from '@/components/ui/spinner'
import { useFileTransfer } from '@/hooks/useFileTransfer'
import { useAppStore, type AppState, type Tab } from '@/store/appStore'

const TerminalTab = lazy(() => import('@/components/terminal/TerminalTab').then((module) => ({ default: module.TerminalTab })))
const PlaybackTab = lazy(() => import('@/components/terminal/PlaybackTab').then((module) => ({ default: module.PlaybackTab })))
const FilePanel = lazy(() => import('@/components/file/FilePanel'))

type FileTransfer = ReturnType<typeof useFileTransfer>

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

function DynamicLayer({ tab, active, filePanelSessionID, onToggleFiles, onCloseFiles }: {
  tab: Tab
  active: boolean
  filePanelSessionID: number | null
  onToggleFiles: (sessionID: number) => void
  onCloseFiles: () => void
}) {
  const layerClass = `absolute inset-0 flex ${active ? 'visible' : 'invisible pointer-events-none'}`
  return (
    <div data-layer-id={tab.id} aria-hidden={!active} inert={active ? undefined : true} className={layerClass}>
      {tab.type === 'terminal' ? <>
        <div className="flex min-w-0 flex-1 flex-col">
          <TerminalTab terminalID={tab.terminalId ?? tab.id} sessionId={tab.sessionId ?? 0}
            onOpenFiles={() => onToggleFiles(tab.sessionId ?? 0)} active={active} />
        </div>
        {active && tab.sessionId === filePanelSessionID
          ? <FilePanelContainer sessionID={filePanelSessionID} onClose={onCloseFiles} />
          : null}
      </> : <PlaybackTab recordingId={tab.terminalId ?? tab.id} title={tab.title} />}
    </div>
  )
}

function requestedTerminalID(
  activeSurface: AppState['activeSurface'],
  focusRequest: AppState['focusRequest'],
  tabs: Tab[],
  activePaneID: string | null,
): string | undefined {
  if (focusRequest.sequence === 0 || activeSurface?.type !== 'terminal' || activeSurface.id !== focusRequest.id) return undefined
  const tab = tabs.find((item) => item.id === activeSurface.id)
  return activePaneID ?? tab?.terminalId ?? tab?.id
}

function useRequestedTerminalFocus() {
  const activeSurface = useAppStore((state) => state.activeSurface)
  const focusRequest = useAppStore((state) => state.focusRequest)
  const tabs = useAppStore((state) => state.tabs)
  const terminalPool = useAppStore((state) => state.terminalPool)
  const activePaneID = useAppStore((state) => state.activePaneId)
  const handledSequences = useRef(new Map<string, number>())

  useEffect(() => {
    const terminalID = requestedTerminalID(activeSurface, focusRequest, tabs, activePaneID)
    const handledSequence = handledSequences.current.get(focusRequest.id) ?? 0
    if (!terminalID || focusRequest.sequence <= handledSequence) return
    const terminal = terminalPool.get(terminalID)?.terminal
    if (!terminal) return
    handledSequences.current.set(focusRequest.id, focusRequest.sequence)
    terminal.focus()
  }, [activePaneID, activeSurface, focusRequest, tabs, terminalPool])
}

export function TerminalLayers() {
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const [filePanelSessionID, setFilePanelSessionID] = useState<number | null>(null)
  useRequestedTerminalFocus()

  const toggleFiles = useCallback((sessionID: number) => {
    if (sessionID === 0) return
    setFilePanelSessionID((current) => current === sessionID ? null : sessionID)
  }, [])

  return <>{tabs.map((tab) => <DynamicLayer key={tab.id} tab={tab}
    active={activeSurface?.type === tab.type && activeSurface.id === tab.id}
    filePanelSessionID={filePanelSessionID} onToggleFiles={toggleFiles}
    onCloseFiles={() => setFilePanelSessionID(null)} />)}</>
}
