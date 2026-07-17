import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'
import { Dialogs, Events } from '@wailsio/runtime'
import { Spinner } from '@/components/ui/spinner'
import { TerminalErrorBoundary } from '@/components/terminal/TerminalErrorBoundary'
import { useFileTransfer } from '@/hooks/useFileTransfer'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { useAppStore, type AppState, type Tab } from '@/store/appStore'
import { dynamicPanelID, dynamicTabID } from '@/store/tabNavigation'
import { TabCloseConfirmation, useTabCloseCoordinator } from '@/hooks/useTabCloseCoordinator'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'

const TerminalTab = lazy(() => import('@/components/terminal/TerminalTab').then((module) => ({ default: module.TerminalTab })))
const PlaybackTab = lazy(() => import('@/components/terminal/PlaybackTab').then((module) => ({ default: module.PlaybackTab })))
const FilePanel = lazy(() => import('@/components/file/FilePanel'))

type FileTransfer = ReturnType<typeof useFileTransfer>
const noFocusRequest: TerminalFocusRequest = { sequence: 0, targetTerminalID: null }

function useLayerFocusRequest(tab: Tab, active: boolean, focusRequest: AppState['focusRequest'], activePaneID: string | null, lastActiveTerminalTabID: string | null) {
  const resolvedRequestRef = useRef<TerminalFocusRequest>(noFocusRequest)
  if (tab.type !== 'terminal' || focusRequest.id !== tab.id || focusRequest.sequence === 0) return noFocusRequest
  if (resolvedRequestRef.current.sequence !== focusRequest.sequence) {
    const primaryTerminalID = tab.terminalId
    const canUseActivePane = active && (lastActiveTerminalTabID === null || lastActiveTerminalTabID === tab.id)
    resolvedRequestRef.current = {
      sequence: focusRequest.sequence,
      targetTerminalID: focusRequest.terminalId ?? (canUseActivePane ? activePaneID ?? primaryTerminalID : primaryTerminalID),
    }
  }
  return resolvedRequestRef.current
}

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

function FilePanelContainer({ sessionID, terminalID, onClose }: { sessionID: number; terminalID: string; onClose: () => void }) {
  const transfer = useFileTransfer(sessionID)
  const dropTargetID = `sftp-drop-zone-${terminalID}`

  useEffect(() => { void transfer.listFiles('/') }, [transfer.listFiles])
  useEffect(() => Events.On('sftp:files-dropped', (event: { data?: { files?: string[]; details?: { id?: string } } }) => {
    const files = event.data?.files ?? []
    const targetID = event.data?.details?.id
    if (files.length === 0 || targetID !== dropTargetID) return
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

function DynamicLayer({ tab, active, activePaneID, lastActiveTerminalTabID, filePanelOpen, onToggleFiles, onCloseFiles, focusRequest, onClose, onReconnect }: {
  tab: Tab
  active: boolean
  activePaneID: string | null
  lastActiveTerminalTabID: string | null
  filePanelOpen: boolean
  onToggleFiles: () => void
  onCloseFiles: () => void
  focusRequest: AppState['focusRequest']
  onClose: () => void
  onReconnect: () => void
}) {
  const layerClass = `absolute inset-0 flex ${active ? 'visible' : 'invisible pointer-events-none'}`
  const terminalFocusRequest = useLayerFocusRequest(tab, active, focusRequest, activePaneID, lastActiveTerminalTabID)
  return (
    <div id={dynamicPanelID(tab.id)} data-layer-id={tab.id} role="tabpanel" aria-labelledby={dynamicTabID(tab.id)} aria-hidden={!active} inert={active ? undefined : true} className={layerClass}>
      <TerminalErrorBoundary onClose={onClose}>
        {tab.type === 'terminal' ? <>
          <div className="flex min-w-0 flex-1 flex-col">
            <TerminalTab terminalID={tab.terminalId} sessionId={tab.sessionId}
              onOpenFiles={onToggleFiles} active={active} focusRequest={terminalFocusRequest} onReconnect={onReconnect} />
          </div>
          {filePanelOpen
            ? <FilePanelContainer sessionID={tab.sessionId} terminalID={tab.terminalId} onClose={onCloseFiles} />
            : null}
        </> : <PlaybackTab recordingId={tab.recordingPath} title={tab.title} active={active} />}
      </TerminalErrorBoundary>
    </div>
  )
}

export function TerminalLayers() {
  const { reconnect } = useSessionWorkspace()
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const focusRequest = useAppStore((state) => state.focusRequest)
  const activePaneID = useAppStore((state) => state.activePaneId)
  const updateTerminalWorkspace = useAppStore((state) => state.updateTerminalWorkspace)
  const lastActiveTerminalTabIDRef = useRef<string | null>(null)
  const closeCoordinator = useTabCloseCoordinator()

  useEffect(() => {
    if (activeSurface?.type === 'terminal') lastActiveTerminalTabIDRef.current = activeSurface.id
  }, [activeSurface])

  const toggleFiles = useCallback((tabID: string) => {
    const tab = useAppStore.getState().tabs.find((item) => item.id === tabID)
    if (tab?.type === 'terminal') updateTerminalWorkspace(tabID, { toolPanel: tab.toolPanel === 'files' ? null : 'files' })
  }, [updateTerminalWorkspace])

  const closeFiles = useCallback((tabID: string) => {
    updateTerminalWorkspace(tabID, { toolPanel: null })
  }, [updateTerminalWorkspace])

  return <>{tabs.map((tab) => <DynamicLayer key={tab.id} tab={tab}
    active={activeSurface?.type === tab.type && activeSurface.id === tab.id}
    activePaneID={activePaneID} lastActiveTerminalTabID={lastActiveTerminalTabIDRef.current}
    filePanelOpen={tab.type === 'terminal' && tab.toolPanel === 'files'} onToggleFiles={() => toggleFiles(tab.id)}
    focusRequest={focusRequest} onCloseFiles={() => closeFiles(tab.id)}
    onReconnect={() => { void reconnect(tab.id) }}
    onClose={() => closeCoordinator.requestClose(tab.id)} />)}
    <TabCloseConfirmation {...closeCoordinator.confirmation} />
  </>
}
