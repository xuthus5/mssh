import { useState, useCallback, useEffect, useRef } from 'react'
import { SessionService } from '@/lib/wails'
import { useConnectDialog } from '@/store/connectDialog'
import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import type { SessionInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { mapFolder, mapSession, type AssetEnvironment, type AssetProject, type AssetTag, type Folder, type Session } from '@/lib/sessionModels'
import { useSessionAssetCatalog } from '@/hooks/useSessionAssetCatalog'
import { useSessionCSVTransfer } from '@/hooks/useSessionCSVTransfer'
import { remapAfterFolderDelete } from '@/lib/sessionFolderDelete'
import { useSessionConnectionActions } from '@/hooks/useSessionConnectionActions'
import { cancelTransfersForSessions, closeTerminalTabsForSessions } from '@/hooks/sessionTabLifecycle'
import { t } from '@/i18n'


export type { BatchSessionResult } from '@/lib/sessionBatch'
export type { AssetColorToken, AssetEnvironment, AssetProject, AssetTag, Folder, Session, Tunnel } from '@/lib/sessionModels'

export function useSession() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const foldersRef = useRef(folders)
  const sessionsRef = useRef(sessions)
  foldersRef.current = folders
  sessionsRef.current = sessions
  const [recentSessions, setRecentSessions] = useState<Session[]>([])
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
      // page banner owns load failures; silent path rethrows for nested refresh.
      if (options?.silent) throw err
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
      // page banner owns load failures; silent path rethrows for nested refresh.
      if (options?.silent) throw err
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
      // page banner owns load failures; silent path rethrows for nested refresh.
      if (options?.silent) throw err
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('updateSession error', err)
      toast(t('更新会话失败: ${}', msg), 'error')
      throw err
    }
    // Persist already succeeded; hydrate list from payload, then best-effort server refresh.
    setSessions((prev) => prev.map((item) => (item.id === session.id ? { ...item, ...session, password: undefined } : item)))
    try {
      const refreshed = await SessionService.GetSession(Number(session.id))
      if (refreshed) setSessions((prev) => prev.map((item) => (item.id === session.id ? mapSession(refreshed) : item)))
    } catch (refreshError) {
      logger.error('updateSession getSession refresh failed', refreshError)
    }
    try {
      await listAssetCatalogs({ silent: true })
    } catch (refreshError) {
      logger.error('updateSession catalog refresh failed', refreshError)
    }
  }, [listAssetCatalogs])

  const deleteSession = useCallback(async (id: string) => {
    try {
      await SessionService.DeleteSession(Number(id))
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setRecentSessions((prev) => prev.filter((s) => s.id !== id))
      useConnectDialog.getState().dismissForSessions([id])
      cancelTransfersForSessions([id])
      await closeTerminalTabsForSessions([id])
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

  const connection = useSessionConnectionActions({
    sessions,
    setSessions,
    setRecentSessions,
    listSessions,
    listRecentSessions,
    refreshAssets,
  })

  useEffect(() => {
    listFolders()
    listSessions()
    listRecentSessions()
    listAssetCatalogs()
  }, [listAssetCatalogs, listFolders, listRecentSessions, listSessions])

  return {
    folders, sessions, recentSessions, environments, projects, tags, loading, sessionsLoaded, error,
    listFolders, createFolder, deleteFolder, updateFolder, setDefaultFolder,
    listSessions, listRecentSessions, createSession, updateSession, deleteSession, moveSession,
    ...connection,
    ...csvTransfer,
    ...assetCatalog,
  }
}
