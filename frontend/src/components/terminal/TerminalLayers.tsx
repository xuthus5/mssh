import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Dialogs, Events } from '@wailsio/runtime'
import { Spinner } from '@/components/ui/spinner'
import { TerminalErrorBoundary } from '@/components/terminal/TerminalErrorBoundary'
import { useFileTransfer } from '@/hooks/useFileTransfer'
import { useSFTPSettings } from '@/hooks/useSFTPSettings'
import { MANUAL_TERMINAL_DIRECTORY_REPORT, waitForTerminalWorkingDirectory } from '@/hooks/terminalDirectoryRuntime'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { useAppStore, type AppState, type Tab } from '@/store/appStore'
import { useSFTPSettingsStore } from '@/store/sftpSettingsStore'
import { useTerminalDirectoryStore } from '@/store/terminalDirectoryStore'
import { TerminalService } from '@/lib/wails'
import { toast } from '@/components/ui/toast'
import { dynamicPanelID, dynamicTabID } from '@/store/tabNavigation'
import { TabCloseConfirmation, useTabCloseCoordinator } from '@/hooks/useTabCloseCoordinator'
import { t } from '@/i18n'


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

function FilePanelView({ transfer, onClose, onUpload, onDownload, dropTargetID, showHiddenFiles, defaultView, onLoadDirectory, onSyncCurrentDirectory, syncingCurrentDirectory }: {
  transfer: FileTransfer
  onClose: () => void
  onUpload: () => void
  onDownload: (path: string) => void
  dropTargetID: string
  showHiddenFiles: boolean
  defaultView: 'list' | 'tree'
  onLoadDirectory: (path: string) => Promise<import('@/hooks/useFileTransfer').FileInfo[]>
  onSyncCurrentDirectory: () => void
  syncingCurrentDirectory: boolean
}) {
  return (
    <Suspense fallback={<div className="grid w-[340px] place-items-center border-l"><Spinner /></div>}>
      <FilePanel open onClose={onClose} files={transfer.files} currentPath={transfer.currentPath}
        loading={transfer.loading} error={transfer.error} onNavigateTo={transfer.navigateTo}
        onNavigateUp={transfer.navigateUp} onDelete={transfer.deleteFile} onRename={transfer.renameFile}
        onMakeDir={transfer.makeDir} onUpload={onUpload} onDownload={onDownload} dropTargetId={dropTargetID}
        showHiddenFiles={showHiddenFiles} defaultView={defaultView} onLoadDirectory={onLoadDirectory}
        onSyncCurrentDirectory={onSyncCurrentDirectory} syncingCurrentDirectory={syncingCurrentDirectory} />
    </Suspense>
  )
}

function FilePanelContainer({ sessionID, terminalID, onClose }: { sessionID: number; terminalID: string; onClose: () => void }) {
  const transfer = useFileTransfer(sessionID)
  const showHiddenFiles = useSFTPSettingsStore((state) => state.showHiddenFiles)
  const followTerminalDirectory = useSFTPSettingsStore((state) => state.followTerminalDirectory)
  const defaultView = useSFTPSettingsStore((state) => state.defaultView)
  const terminalDirectory = useTerminalDirectoryStore((state) => state.directories[terminalID])
  const dropTargetID = `sftp-drop-zone-${terminalID}`
  const loadedInitialPath = useRef(false)
  const [syncingCurrentDirectory, setSyncingCurrentDirectory] = useState(false)

  useEffect(() => {
    if (!loadedInitialPath.current) {
      loadedInitialPath.current = true
      void transfer.listFiles(followTerminalDirectory && terminalDirectory ? terminalDirectory : '/')
      return
    }
    if (followTerminalDirectory && terminalDirectory) void transfer.listFiles(terminalDirectory)
  }, [followTerminalDirectory, terminalDirectory, transfer.listFiles])

  const syncCurrentDirectory = useCallback(async () => {
    if (syncingCurrentDirectory) return
    setSyncingCurrentDirectory(true)
    const previousRevision = useTerminalDirectoryStore.getState().revisions[terminalID] ?? 0
    try {
      await TerminalService.Write(terminalID, MANUAL_TERMINAL_DIRECTORY_REPORT)
      const path = await waitForTerminalWorkingDirectory(terminalID, previousRevision)
      if (!followTerminalDirectory || path === transfer.currentPath) await transfer.listFiles(path)
      toast(t('已同步当前目录: ${}', path), 'success')
    } catch (error) {
      toast(t('同步当前目录失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      setSyncingCurrentDirectory(false)
    }
  }, [followTerminalDirectory, syncingCurrentDirectory, terminalID, transfer.currentPath, transfer.listFiles])
  useEffect(() => Events.On('sftp:files-dropped', (event: { data?: { files?: string[]; details?: { id?: string } } }) => {
    const files = event.data?.files ?? []
    const targetID = event.data?.details?.id
    if (files.length === 0 || targetID !== dropTargetID) return
    void transfer.uploadMany(files, transfer.currentPath)
  }), [dropTargetID, transfer.currentPath, transfer.uploadMany])

  const handleUpload = useCallback(async () => {
    const selected = await Dialogs.OpenFile({ Title: t('选择要上传的文件'), CanChooseFiles: true, CanChooseDirectories: false, AllowsMultipleSelection: false })
    const localPath = typeof selected === 'string' ? selected : selected[0]
    if (localPath) await transfer.upload(localPath, transfer.currentPath)
  }, [transfer.currentPath, transfer.upload])

  const handleDownload = useCallback(async (remotePath: string) => {
    const localPath = await Dialogs.SaveFile({ Title: t('选择下载位置'), Filename: remotePath.split('/').pop() ?? 'download', CanCreateDirectories: true })
    if (localPath) await transfer.download(remotePath, localPath)
  }, [transfer.download])

  return <FilePanelView transfer={transfer} onClose={onClose} onUpload={() => { void handleUpload() }}
    onDownload={(path) => { void handleDownload(path) }} dropTargetID={dropTargetID} showHiddenFiles={showHiddenFiles}
    defaultView={defaultView} onLoadDirectory={transfer.loadDirectory} onSyncCurrentDirectory={() => { void syncCurrentDirectory() }}
    syncingCurrentDirectory={syncingCurrentDirectory} />
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

export function TerminalLayers() {
  useSFTPSettings()
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const focusRequest = useAppStore((state) => state.focusRequest)
  const activePaneID = useAppStore((state) => state.activePaneId)
  const updateTerminalWorkspace = useAppStore((state) => state.updateTerminalWorkspace)
  const [fileTargets, setFileTargets] = useState<Record<string, string>>({})
  const lastActiveTerminalTabIDRef = useRef<string | null>(null)
  const closeCoordinator = useTabCloseCoordinator()

  useEffect(() => {
    if (activeSurface?.type === 'terminal') lastActiveTerminalTabIDRef.current = activeSurface.id
  }, [activeSurface])
  useEffect(() => {
    const tabIDs = new Set(tabs.map((tab) => tab.id))
    setFileTargets((current) => Object.fromEntries(Object.entries(current).filter(([tabID]) => tabIDs.has(tabID))))
  }, [tabs])

  const toggleFiles = useCallback((tabID: string, terminalID: string) => {
    const tab = useAppStore.getState().tabs.find((item) => item.id === tabID)
    if (tab?.type !== 'terminal' || tab.connectionKind === 'serial') return
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
    if (fileTargets[tabID] !== previousID) return
    setFileTargets((current) => ({ ...current, [tabID]: nextID }))
  }, [fileTargets])

  return <>{tabs.map((tab) => <DynamicLayer key={tab.id} tab={tab}
    active={activeSurface?.type === tab.type && activeSurface.id === tab.id}
    activePaneID={activePaneID} lastActiveTerminalTabID={lastActiveTerminalTabIDRef.current}
    fileTargetID={fileTargets[tab.id] ?? null}
    filePanelOpen={tab.type === 'terminal' && tab.toolPanel === 'files'} onToggleFiles={(terminalID) => toggleFiles(tab.id, terminalID)}
    onPaneClosed={(terminalID) => handlePaneClosed(tab.id, terminalID)}
    onPaneReplaced={(previousID, nextID) => handlePaneReplaced(tab.id, previousID, nextID)}
    focusRequest={focusRequest} onCloseFiles={() => closeFiles(tab.id)}
    onClose={() => closeCoordinator.requestClose(tab.id)} />)}
    <TabCloseConfirmation {...closeCoordinator.confirmation} />
  </>
}
