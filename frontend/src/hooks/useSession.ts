import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store/appStore'
import { SessionService, TerminalService, TunnelService } from '@/lib/wails'
import { useConnectDialog } from '@/store/connectDialog'
import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { createTerminalTab } from '@/lib/terminalTabs'
import type { SessionInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { markIntentionalDisconnect, reconnectSessionTab } from '@/hooks/sessionReconnect'
import { runBatchDeleteSessions, runBatchSessions } from '@/lib/sessionBatch'
import { mapFolder, mapSession, mapTunnel, type AssetEnvironment, type AssetProject, type AssetTag, type Folder, type Session, type Tunnel } from '@/lib/sessionModels'
import { useSessionAssetCatalog } from '@/hooks/useSessionAssetCatalog'
import { useSessionCSVTransfer } from '@/hooks/useSessionCSVTransfer'
import { remapAfterFolderDelete } from '@/lib/sessionFolderDelete'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { resolveOpenTerminalSize } from '@/lib/terminalOpenSize'
import { t } from '@/i18n'


export type { BatchSessionResult } from '@/lib/sessionBatch'
export type { AssetColorToken, AssetEnvironment, AssetProject, AssetTag, Folder, Session, Tunnel } from '@/lib/sessionModels'

async function openSessionTab(session: Session): Promise<string> {
  const size = resolveOpenTerminalSize()
  const terminalId = await openTerminalWithPoolCapacity(
    () => TerminalService.Open(Number(session.id), size.cols, size.rows),
  )
  const store = useAppStore.getState()
  const tab = createTerminalTab({ sessionID: Number(session.id), sessionName: session.name, terminalID: terminalId, tabs: store.tabs })
  store.setConnectionStatus(terminalId, 'connected')
  store.openTab(tab)
  return terminalId
}

export function useSession() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const foldersRef = useRef(folders)
  const sessionsRef = useRef(sessions)
  foldersRef.current = folders
  sessionsRef.current = sessions
  const [recentSessions, setRecentSessions] = useState<Session[]>([])
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [environments, setEnvironments] = useState<AssetEnvironment[]>([])
  const [projects, setProjects] = useState<AssetProject[]>([])
  const [tags, setTags] = useState<AssetTag[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [error, setError] = useState('')
  const assetCatalog = useSessionAssetCatalog({ environments, projects, setEnvironments, setProjects, setTags, setSessions, setRecentSessions, setError })
  const { listAssetCatalogs, refreshAssets } = assetCatalog

  const listFolders = useCallback(async (options?: { silent?: boolean }) => {
    setLoading(true)
    setError('')
    try {
      const result = await SessionService.ListFolders()
      setFolders((result ?? []).map(mapFolder))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('listFolders error', err)
      setError(msg)
      if (!options?.silent) toast(t('加载分组失败: ${}', msg), 'error')
      else throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const createFolder = useCallback(async (name: string, parentId: string | null) => {
    try {
      const result = await SessionService.CreateFolder(name, parentId ? Number(parentId) : null)
      if (result) {
        setFolders((prev) => [...prev, mapFolder(result)])
      }
      return result ? mapFolder(result) : undefined
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('createFolder error', err)
      toast(t('创建分组失败: ${}', msg), 'error')
      throw err
    }
  }, [])

  const deleteFolder = useCallback(async (id: string) => {
    try {
      await SessionService.DeleteFolder(Number(id))
      const remapped = remapAfterFolderDelete(foldersRef.current, sessionsRef.current, id)
      setFolders(remapped.folders)
      setSessions(remapped.sessions)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('deleteFolder error', err)
      toast(t('删除分组失败: ${}', msg), 'error')
      throw err
    }
  }, [])

  const updateFolder = useCallback(async (id: string, name: string) => {
    try {
      await SessionService.UpdateFolder(Number(id), name)
      setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('updateFolder error', err)
      toast(t('更新分组失败: ${}', msg), 'error')
      throw err
    }
  }, [])

  const setDefaultFolder = useCallback(async (id: string) => {
    try {
      await SessionService.SetDefaultFolder(Number(id))
      setFolders((prev) => prev.map((folder) => ({ ...folder, isDefault: folder.id === id })))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('setDefaultFolder error', err)
      toast(t('设置默认分组失败: ${}', msg), 'error')
      throw err
    }
  }, [])

  const listSessions = useCallback(async (options?: { silent?: boolean }) => {
    setLoading(true)
    setError('')
    try {
      const result = await SessionService.ListSessions(null)
      setSessions((result ?? []).map(mapSession))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('listSessions error', err)
      setError(msg)
      if (!options?.silent) toast(t('加载会话失败: ${}', msg), 'error')
      else throw err
    } finally {
      setLoading(false)
      setSessionsLoaded(true)
    }
  }, [])

  const listRecentSessions = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const result = await SessionService.ListRecentSessions(10)
      setRecentSessions((result ?? []).map(mapSession))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('listRecentSessions error', err)
      setError(msg)
      if (!options?.silent) toast(t('加载最近会话失败: ${}', msg), 'error')
      else throw err
    }
  }, [])
  const csvTransfer = useSessionCSVTransfer({ refreshFolders: listFolders, refreshAssets })

  const createSession = useCallback(async (session: Omit<Session, 'id'>) => {
    try {
      const result = await SessionService.CreateSession({
        name: session.name,
        host: session.host,
        port: session.port,
        username: session.username,
        notes: session.notes ?? '', environment_id: session.environmentId ? Number(session.environmentId) : null,
        project_id: session.projectId ? Number(session.projectId) : null, tag_ids: (session.tags ?? []).map((tag) => Number(tag.id)),
        auth_method: session.authMethod as SessionInput['auth_method'],
        password: session.password,
        key_id: session.keyId ? Number(session.keyId) : null,
        keep_alive: session.keepAlive,
        term_type: session.termType,
        folder_id: session.folderId ? Number(session.folderId) : null,
        id: 0,
        sort_order: 0,
      } satisfies SessionInput)
      if (result) {
        setSessions((prev) => [...prev, mapSession(result)])
        try {
          await listAssetCatalogs({ silent: true })
        } catch (refreshError) {
          logger.error('createSession catalog refresh failed', refreshError)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('createSession error', err)
      toast(t('创建会话失败: ${}', msg), 'error')
      throw err
    }
  }, [listAssetCatalogs])

  const updateSession = useCallback(async (session: Session) => {
    try {
      await SessionService.UpdateSession({
        id: Number(session.id),
        name: session.name,
        host: session.host,
        port: session.port,
        username: session.username,
        notes: session.notes ?? '', environment_id: session.environmentId ? Number(session.environmentId) : null,
        project_id: session.projectId ? Number(session.projectId) : null, tag_ids: (session.tags ?? []).map((tag) => Number(tag.id)),
        auth_method: session.authMethod as SessionInput['auth_method'],
        password: session.password,
        key_id: session.keyId ? Number(session.keyId) : null,
        keep_alive: session.keepAlive,
        term_type: session.termType,
        folder_id: session.folderId ? Number(session.folderId) : null,
        sort_order: 0,
      } satisfies SessionInput)
      const refreshed = await SessionService.GetSession(Number(session.id))
      if (refreshed) setSessions((prev) => prev.map((item) => (item.id === session.id ? mapSession(refreshed) : item)))
      try {
        await listAssetCatalogs({ silent: true })
      } catch (refreshError) {
        logger.error('updateSession catalog refresh failed', refreshError)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('updateSession error', err)
      toast(t('更新会话失败: ${}', msg), 'error')
      throw err
    }
  }, [listAssetCatalogs])

  const deleteSession = useCallback(async (id: string) => {
    try {
      await SessionService.DeleteSession(Number(id))
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('deleteSession error', err)
      toast(t('删除会话失败: ${}', msg), 'error')
      throw err
    }
  }, [])

  const moveSession = useCallback(async (id: string, folderId: string | null) => {
    try {
      await SessionService.MoveSession(Number(id), folderId ? Number(folderId) : null)
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, folderId } : s)))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('moveSession error', err)
      toast(t('移动会话失败: ${}', msg), 'error')
      throw err
    }
  }, [])

  const connect = useCallback(async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return
    const dialog = useConnectDialog.getState()
    if (dialog.open) return void toast(t('已有 SSH 连接正在处理，请先完成或关闭当前连接窗口'), 'info')
    dialog.openDialog(session.host, session.port, session.username, () => { void connect(sessionId) })
    try {
      const terminalId = await openSessionTab(session)
      dialog.setState('connected')
      logger.info('connected', { terminalId, host: session.host })
      // Session is already open; refresh failures must not flip the dialog to failed.
      void Promise.all([
        listRecentSessions({ silent: true }),
        listSessions({ silent: true }),
      ]).catch((refreshError: unknown) => {
        logger.error('connect post-refresh failed', refreshError)
      })
    } catch (err) {
      logger.error('connect error', err)
      const msg = err instanceof Error ? err.message : String(err)
      dialog.setError(msg)
    }
  }, [listRecentSessions, listSessions, sessions])

  const runBatch = useCallback(async (sessionIDs: string[], command?: string) => {
    const selected = sessionIDs.map((id) => sessions.find((session) => session.id === id)).filter((session): session is Session => session !== undefined)
    const results = await runBatchSessions(selected, command)
    // Batch outcomes are already final; silent refresh must not block or rebrand success as failure.
    void refreshAssets({ silent: true }).catch((refreshError: unknown) => {
      logger.error('batch post-refresh failed', refreshError)
    })
    return results
  }, [refreshAssets, sessions])
  const batchConnect = useCallback((sessionIDs: string[]) => runBatch(sessionIDs), [runBatch])
  const batchExecuteMacro = useCallback((sessionIDs: string[], command: string) => runBatch(sessionIDs, command), [runBatch])
  const batchDeleteSessions = useCallback(async (sessionIDs: string[]) => {
    const selected = sessionIDs.map((id) => sessions.find((session) => session.id === id)).filter((session): session is Session => session !== undefined)
    const results = await runBatchDeleteSessions(selected)
    const succeeded = new Set(results.filter((result) => result.success).map((result) => result.sessionId))
    if (succeeded.size > 0) {
      setSessions((prev) => prev.filter((session) => !succeeded.has(session.id)))
      setRecentSessions((prev) => prev.filter((session) => !succeeded.has(session.id)))
    }
    // Local delete results already applied; silent refresh reconciles without aborting the results dialog.
    void refreshAssets({ silent: true }).catch((refreshError: unknown) => {
      logger.error('batch delete post-refresh failed', refreshError)
    })
    return results
  }, [refreshAssets, sessions])

  const disconnect = useCallback(async (terminalId: string) => {
    try {
      markIntentionalDisconnect(terminalId)
      await TerminalService.Close(terminalId)
      useAppStore.getState().setConnectionStatus(terminalId, 'disconnected')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('disconnect error', err)
      toast(t('断开连接失败: ${}', msg), 'error')
    }
  }, [])
  const reconnect = useCallback((tabId: string) => reconnectSessionTab(tabId, sessions), [sessions])
  const listTunnels = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const result = await TunnelService.List()
      setTunnels((result ?? []).map(mapTunnel))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('listTunnels error', err)
      if (!options?.silent) toast(t('加载隧道失败: ${}', msg), 'error')
      else throw err
    }
  }, [])

  useEffect(() => {
    listFolders()
    listSessions()
    listRecentSessions()
    listAssetCatalogs()
  }, [listAssetCatalogs, listFolders, listRecentSessions, listSessions])

  return {
    folders, sessions, recentSessions, tunnels, environments, projects, tags, loading, sessionsLoaded, error,
    listFolders, createFolder, deleteFolder, updateFolder, setDefaultFolder,
    listSessions, listRecentSessions, createSession, updateSession, deleteSession, moveSession,
    connect, batchConnect, batchExecuteMacro, batchDeleteSessions, reconnect, disconnect, listTunnels,
    ...csvTransfer,
    ...assetCatalog,
  }
}
