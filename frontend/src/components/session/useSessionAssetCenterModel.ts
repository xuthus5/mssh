import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import type { Folder, Session } from '@/hooks/useSession'
import type { DeleteTarget } from '@/components/session/SessionFolderAssetTable'
import { filterSessionAssets } from '@/lib/sessionAssetSearch'
import { useSessionAssetFilterStore } from '@/store/sessionAssetFilterStore'
import { useAppStore } from '@/store/appStore'
import { t } from '@/i18n'

export type AssetTab = 'recent' | 'folders' | 'nodes' | 'catalog'

export function useSessionAssetCenterModel() {
  const workspace = useSessionWorkspace()
  const filters = useSessionAssetFilterStore((store) => store.filters)
  const setFilters = useSessionAssetFilterStore((store) => store.setFilters)
  const resetFilters = useSessionAssetFilterStore((store) => store.resetFilters)
  const tabs = useAppStore((store) => store.tabs)
  const connectionStatus = useAppStore((store) => store.connectionStatus)
  const selection = useAssetCenterSelection()
  const lifecycle = useLifecycleRef()
  const actions = useAssetCenterActions(workspace, lifecycle)
  const deletion = useAssetCenterDeletion({ workspace, lifecycle, detailID: selection.detailID, setDetailID: selection.setDetailID })
  const folderSessions = useMemo(() => workspace.sessions.filter((session) => !selection.folderID || session.folderId === selection.folderID), [selection.folderID, workspace.sessions])
  const filteredSessions = useMemo(() => filterSessionAssets(folderSessions, workspace.folders, filters), [filters, folderSessions, workspace.folders])
  const detailSession = workspace.sessions.find((session) => session.id === selection.detailID) ?? null
  const activeTerminalCount = useMemo(() => countActiveTerminals(tabs, connectionStatus, selection.detailID), [connectionStatus, selection.detailID, tabs])
  const retry = () => void Promise.all([workspace.listFolders(), workspace.listSessions(), workspace.listRecentSessions(), workspace.listAssetCatalogs?.()]).catch(() => undefined)
  return { workspace, filters, setFilters, resetFilters, ...selection, ...actions, ...deletion,
    filteredSessions, detailSession, activeTerminalCount, retry }
}

function useAssetCenterSelection() {
  const [tab, setTab] = useState<AssetTab>('recent')
  const [folderID, setFolderID] = useState<string | null>(null)
  const [selectedIDs, setSelectedIDs] = useState<Set<string>>(() => new Set())
  const [detailID, setDetailID] = useState<string | null>(null)
  useEffect(() => {
    const selectFolder = (event: Event) => {
      setFolderID((event as CustomEvent<string>).detail); setTab('nodes')
    }
    window.addEventListener('mssh:select-folder', selectFolder)
    return () => window.removeEventListener('mssh:select-folder', selectFolder)
  }, [])
  const clearSelection = () => setSelectedIDs(new Set())
  const removeSelection = (ids: string[]) => setSelectedIDs((previous) => {
    const next = new Set(previous)
    ids.forEach((id) => next.delete(id))
    return next
  })
  return { tab, setTab, folderID, setFolderID, selectedIDs, setSelectedIDs, detailID, setDetailID, clearSelection, removeSelection }
}

type Workspace = ReturnType<typeof useSessionWorkspace>

function useAssetCenterActions(workspace: Workspace, lifecycle: { current: number }) {
  const [actionError, setActionError] = useState('')
  const [movingSessionIDs, setMovingSessionIDs] = useState<Set<string>>(() => new Set())
  const actionRequest = useRef(0)
  const activeActions = useRef(new Set<string>())
  const runAction = async (key: string, action: () => Promise<unknown>, failureTemplate: string) => {
    if (activeActions.current.has(key)) return
    activeActions.current.add(key)
    const lifecycleToken = lifecycle.current
    const request = ++actionRequest.current
    setActionError('')
    try {
      await action()
    } catch (error) {
      if (lifecycle.current === lifecycleToken && actionRequest.current === request) {
        setActionError(t(failureTemplate, error instanceof Error ? error.message : String(error)))
      }
    } finally {
      activeActions.current.delete(key)
    }
  }
  const moveSession = async (id: string, folderID: string | null) => {
    const key = `move:${id}`
    if (activeActions.current.has(key)) return
    const lifecycleToken = lifecycle.current
    setMovingSessionIDs((previous) => new Set(previous).add(id))
    try {
      await runAction(key, () => workspace.moveSession(id, folderID), '移动会话失败: ${}')
    } finally {
      if (lifecycle.current === lifecycleToken) {
        setMovingSessionIDs((previous) => {
          const next = new Set(previous)
          next.delete(id)
          return next
        })
      }
    }
  }
  return { actionError, movingSessionIDs, runAction, moveSession }
}

function useAssetCenterDeletion(options: {
  workspace: Workspace
  lifecycle: { current: number }
  detailID: string | null
  setDetailID: (id: string | null) => void
}) {
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const generation = useRef(0)
  const requestID = useRef(0)
  const active = useRef(false)
  const closeDelete = () => resetDeleteTarget({ generation, requestID, active, setDeleteTarget })
  const openDelete = (target: DeleteTarget) => {
    if (active.current) return
    generation.current++; requestID.current++; setDeleteTarget(target)
  }
  const deleteItem = async (target: DeleteTarget) => {
    if (active.current) return
    active.current = true
    const request = captureDeleteRequest(options.lifecycle, generation, requestID)
    try {
      if (target.type === 'folder') await options.workspace.deleteFolder(target.item.id)
      else await options.workspace.deleteSession(target.item.id)
      if (!request.isCurrent()) return
      if (target.type === 'session' && options.detailID === target.item.id) options.setDetailID(null)
      closeDelete()
    } finally {
      if (requestID.current === request.id) active.current = false
    }
  }
  return { deleteTarget, closeDelete, deleteItem,
    openSessionDelete: (session: Session) => openDelete({ type: 'session', item: session }),
    openFolderDelete: (folder: Folder) => openDelete({ type: 'folder', item: folder }) }
}

function resetDeleteTarget(options: {
  generation: { current: number }
  requestID: { current: number }
  active: { current: boolean }
  setDeleteTarget: (target: DeleteTarget | null) => void
}) {
  options.generation.current++; options.requestID.current++; options.active.current = false
  options.setDeleteTarget(null)
}

function captureDeleteRequest(lifecycle: { current: number }, generation: { current: number }, requestID: { current: number }) {
  const lifecycleToken = lifecycle.current
  const generationToken = generation.current
  const id = ++requestID.current
  return { id, isCurrent: () => lifecycle.current === lifecycleToken
    && generation.current === generationToken && requestID.current === id }
}

function countActiveTerminals(tabs: ReturnType<typeof useAppStore.getState>['tabs'], status: ReturnType<typeof useAppStore.getState>['connectionStatus'], detailID: string | null) {
  return tabs.filter((item) => item.type === 'terminal' && String(item.sessionId) === detailID
    && ['connected', 'reconnecting'].includes(status[item.terminalId])).length
}

function useLifecycleRef() {
  const lifecycle = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return lifecycle
}
