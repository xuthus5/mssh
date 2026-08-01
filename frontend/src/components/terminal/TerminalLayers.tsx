import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { TerminalErrorBoundary } from '@/components/terminal/TerminalErrorBoundary'
import { useSFTPSettings } from '@/hooks/useSFTPSettings'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { useAppStore, type AppState, type Tab } from '@/store/appStore'
import { dynamicPanelID, dynamicTabID } from '@/store/tabNavigation'
import { TabCloseConfirmation, useTabCloseCoordinator } from '@/hooks/useTabCloseCoordinator'
import { useFilePanelRuntime } from '@/components/terminal/useFilePanelRuntime'

const TerminalTab = lazy(() => import('@/components/terminal/TerminalTab').then((module) => ({ default: module.TerminalTab })))
const PlaybackTab = lazy(() => import('@/components/terminal/PlaybackTab').then((module) => ({ default: module.PlaybackTab })))
const FilePanel = lazy(() => import('@/components/file/FilePanel'))

type FileTransfer = ReturnType<typeof useFilePanelRuntime>['transfer']
const noFocusRequest: TerminalFocusRequest = { sequence: 0, targetTerminalID: null }

function useLayerFocusRequest(...args: [Tab, boolean, AppState['focusRequest'], string | null, string | null]) {
  const [tab, active, focusRequest, activePaneID, lastActiveTerminalTabID] = args
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

function FilePanelView({ transfer, actionError, transferActionPending, onClose, onUpload, onDownload, dropTargetID, showHiddenFiles, defaultView, onLoadDirectory, onSyncCurrentDirectory, syncingCurrentDirectory, followsTerminalDirectory }: {
  transfer: FileTransfer
  actionError: string
  transferActionPending: 'upload' | 'download' | null
  onClose: () => void
  onUpload: () => void
  onDownload: (path: string) => void
  dropTargetID: string
  showHiddenFiles: boolean
  defaultView: 'list' | 'tree'
  onLoadDirectory: (path: string) => Promise<import('@/hooks/useFileTransfer').FileInfo[]>
  onSyncCurrentDirectory: () => void
  syncingCurrentDirectory: boolean
  followsTerminalDirectory: boolean
}) {
  return (
    <Suspense fallback={<div className="grid w-[340px] place-items-center border-l"><Spinner /></div>}>
      <FilePanel open onClose={onClose} files={transfer.files} currentPath={transfer.currentPath}
        loading={transfer.loading} error={transfer.error} actionError={actionError} onNavigateTo={transfer.navigateTo}
        onNavigateUp={transfer.navigateUp} onDelete={transfer.deleteFile} onRename={transfer.renameFile}
        onMakeDir={transfer.makeDir} onUpload={onUpload} onDownload={onDownload} dropTargetId={dropTargetID}
        showHiddenFiles={showHiddenFiles} defaultView={defaultView} onLoadDirectory={onLoadDirectory}
        transferActionPending={transferActionPending} onSyncCurrentDirectory={onSyncCurrentDirectory}
        syncingCurrentDirectory={syncingCurrentDirectory} catalogRevision={transfer.catalogRevision}
        externalCatalogRevision={transfer.externalCatalogRevision} directoryMutationBusy={transfer.directoryMutationBusy}
        followsTerminalDirectory={followsTerminalDirectory}
        isMutationBusy={(file) => transfer.isMutationBusy(file.path, file.isDir)} />
    </Suspense>
  )
}

function FilePanelContainer({ sessionID, terminalID, onClose }: { sessionID: number; terminalID: string; onClose: () => void }) {
  const runtime = useFilePanelRuntime(sessionID, terminalID)
  return <FilePanelView transfer={runtime.transfer} actionError={runtime.actionError} transferActionPending={runtime.transferActionPending}
    onClose={onClose} onUpload={() => { void runtime.handleUpload() }}
    onDownload={(path) => { void runtime.handleDownload(path) }} dropTargetID={runtime.dropTargetID} showHiddenFiles={runtime.showHiddenFiles}
    defaultView={runtime.defaultView} onLoadDirectory={runtime.transfer.loadDirectory} onSyncCurrentDirectory={() => { void runtime.syncCurrentDirectory() }}
    syncingCurrentDirectory={runtime.syncingCurrentDirectory} followsTerminalDirectory={runtime.followsTerminalDirectory} />
}

function DynamicLayer({ tab, active, activePaneID, fileTargetID, lastActiveTerminalTabID, filePanelOpen, onToggleFiles, onPaneClosed, onPaneReplaced, onCloseFiles, focusRequest, onClose }: {
  tab: Tab
  active: boolean
  activePaneID: string | null
  fileTargetID: string | null
  lastActiveTerminalTabID: string | null
  filePanelOpen: boolean
  onToggleFiles: (terminalID: string) => void
  onPaneClosed: (terminalID: string) => void
  onPaneReplaced: (previousID: string, nextID: string) => void
  onCloseFiles: () => void
  focusRequest: AppState['focusRequest']
  onClose: () => void
}) {
  const layerClass = `absolute inset-0 flex ${active ? 'visible' : 'invisible pointer-events-none [&_.xterm-cursor-layer]:hidden'}`
  const terminalFocusRequest = useLayerFocusRequest(tab, active, focusRequest, activePaneID, lastActiveTerminalTabID)
  return (
    <div id={dynamicPanelID(tab.id)} data-layer-id={tab.id} role="tabpanel" aria-labelledby={dynamicTabID(tab.id)} aria-hidden={!active} inert={active ? undefined : true} className={layerClass}>
      <TerminalErrorBoundary onClose={onClose}>
        {tab.type === 'terminal' ? <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <TerminalTab terminalID={tab.terminalId} sessionId={tab.sessionId}
              onOpenFiles={onToggleFiles} active={active} focusRequest={terminalFocusRequest}
              onPaneClosed={onPaneClosed} onPaneReplaced={onPaneReplaced} onCloseTerminal={onClose} />
          </div>
          {filePanelOpen
            ? <FilePanelContainer sessionID={tab.sessionId} terminalID={fileTargetID ?? tab.terminalId} onClose={onCloseFiles} />
            : null}
        </> : <PlaybackTab recordingId={tab.recordingPath} title={tab.title} active={active} />}
      </TerminalErrorBoundary>
    </div>
  )
}

function useFilePanelTargets(tabs: Tab[], updateTerminalWorkspace: AppState['updateTerminalWorkspace']) {
  const [fileTargets, setFileTargets] = useState<Record<string, string>>({})
  useEffect(() => {
    const tabIDs = new Set(tabs.map((tab) => tab.id))
    setFileTargets((current) => Object.fromEntries(Object.entries(current).filter(([tabID]) => tabIDs.has(tabID))))
  }, [tabs])
  const toggleFiles = useCallback((tabID: string, terminalID: string) => {
    const tab = useAppStore.getState().tabs.find((item) => item.id === tabID)
    if (tab?.type !== 'terminal' || tab.connectionKind === 'serial' || tab.connectionKind === 'local') return
    const opening = tab.toolPanel !== 'files' || fileTargets[tabID] !== terminalID
    setFileTargets((current) => opening ? { ...current, [tabID]: terminalID } : current)
    updateTerminalWorkspace(tabID, { toolPanel: opening ? 'files' : null })
  }, [fileTargets, updateTerminalWorkspace])
  const closeFiles = useCallback((tabID: string) => {
    updateTerminalWorkspace(tabID, { toolPanel: null })
  }, [updateTerminalWorkspace])
  const handlePaneClosed = useCallback((tabID: string, terminalID: string) => {
    if (fileTargets[tabID] !== terminalID) return
    setFileTargets((current) => {
      const next = { ...current }
      delete next[tabID]
      return next
    })
    updateTerminalWorkspace(tabID, { toolPanel: null })
  }, [fileTargets, updateTerminalWorkspace])
  const handlePaneReplaced = useCallback((tabID: string, previousID: string, nextID: string) => {
    if (fileTargets[tabID] === previousID) setFileTargets((current) => ({ ...current, [tabID]: nextID }))
  }, [fileTargets])
  return { fileTargets, toggleFiles, closeFiles, handlePaneClosed, handlePaneReplaced }
}

export function TerminalLayers() {
  useSFTPSettings()
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const focusRequest = useAppStore((state) => state.focusRequest)
  const activePaneID = useAppStore((state) => state.activePaneId)
  const updateTerminalWorkspace = useAppStore((state) => state.updateTerminalWorkspace)
  const files = useFilePanelTargets(tabs, updateTerminalWorkspace)
  const lastActiveTerminalTabIDRef = useRef<string | null>(null)
  const closeCoordinator = useTabCloseCoordinator()

  useEffect(() => {
    if (activeSurface?.type === 'terminal') lastActiveTerminalTabIDRef.current = activeSurface.id
  }, [activeSurface])
  return <>{tabs.map((tab) => <DynamicLayer key={tab.id} tab={tab}
    active={activeSurface?.type === tab.type && activeSurface.id === tab.id}
    activePaneID={activePaneID} lastActiveTerminalTabID={lastActiveTerminalTabIDRef.current}
    fileTargetID={files.fileTargets[tab.id] ?? null}
    filePanelOpen={tab.type === 'terminal' && (tab.connectionKind ?? 'ssh') === 'ssh' && tab.toolPanel === 'files'} onToggleFiles={(terminalID) => files.toggleFiles(tab.id, terminalID)}
    onPaneClosed={(terminalID) => files.handlePaneClosed(tab.id, terminalID)}
    onPaneReplaced={(previousID, nextID) => files.handlePaneReplaced(tab.id, previousID, nextID)}
    focusRequest={focusRequest} onCloseFiles={() => files.closeFiles(tab.id)}
    onClose={() => closeCoordinator.requestClose(tab.id)} />)}
    <TabCloseConfirmation {...closeCoordinator.confirmation} />
  </>
}
