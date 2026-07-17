import { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { SessionService, TerminalService, TunnelService } from '@/lib/wails'
import { useConnectDialog } from '@/store/connectDialog'
import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { createTerminalTab } from '@/lib/terminalTabs'
import type { SessionInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { reconnectSessionTab } from '@/hooks/sessionReconnect'
import { runBatchSessions } from '@/lib/sessionBatch'
import { mapFolder, mapSession, mapTunnel, type Folder, type Session, type Tunnel } from '@/lib/sessionModels'

export type { BatchSessionResult } from '@/lib/sessionBatch'
export type { Folder, Session, Tunnel } from '@/lib/sessionModels'

async function openSessionTab(session: Session): Promise<string> {
  const terminalId = await TerminalService.Open(Number(session.id), 80, 24)
  const store = useAppStore.getState()
  const tab = createTerminalTab({ sessionID: Number(session.id), sessionName: session.name, terminalID: terminalId, tabs: store.tabs })
  store.setConnectionStatus(terminalId, 'connected')
  store.openTab(tab)
  return terminalId
}

export function useSession() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [recentSessions, setRecentSessions] = useState<Session[]>([])
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [error, setError] = useState('')

  const listFolders = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await SessionService.ListFolders()
      setFolders((result ?? []).map(mapFolder))
    } catch (err) {
      logger.error('listFolders error', err)
      setError(err instanceof Error ? err.message : String(err))
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
      logger.error('createFolder error', err)
      throw err
    }
  }, [])

  const deleteFolder = useCallback(async (id: string) => {
    try {
      await SessionService.DeleteFolder(Number(id))
      setFolders((prev) => {
        const defaultID = prev.find((folder) => folder.isDefault)?.id ?? null
        return prev.filter((folder) => folder.id !== id).map((folder) => folder.parentId === id ? { ...folder, parentId: defaultID } : folder)
      })
      setSessions((prev) => {
        const defaultID = folders.find((folder) => folder.isDefault)?.id ?? null
        return prev.map((session) => session.folderId === id ? { ...session, folderId: defaultID } : session)
      })
    } catch (err) {
      logger.error('deleteFolder error', err)
      throw err
    }
  }, [folders])

  const updateFolder = useCallback(async (id: string, name: string) => {
    try {
      await SessionService.UpdateFolder(Number(id), name)
      setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)))
    } catch (err) {
      logger.error('updateFolder error', err)
      throw err
    }
  }, [])

  const setDefaultFolder = useCallback(async (id: string) => {
    await SessionService.SetDefaultFolder(Number(id))
    setFolders((prev) => prev.map((folder) => ({ ...folder, isDefault: folder.id === id })))
  }, [])

  const listSessions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await SessionService.ListSessions(null)
      setSessions((result ?? []).map(mapSession))
    } catch (err) {
      logger.error('listSessions error', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      setSessionsLoaded(true)
    }
  }, [])

  const listRecentSessions = useCallback(async () => {
    try {
      const result = await SessionService.ListRecentSessions(10)
      setRecentSessions((result ?? []).map(mapSession))
    } catch (err) {
      logger.error('listRecentSessions error', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const createSession = useCallback(async (session: Omit<Session, 'id'>) => {
    try {
      const result = await SessionService.CreateSession({
        name: session.name,
        host: session.host,
        port: session.port,
        username: session.username,
        tags: session.tags ?? '', notes: session.notes ?? '', environment: session.environment ?? '', project: session.project ?? '',
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
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('createSession error', err)
      toast(`创建会话失败: ${msg}`, 'error')
      throw err
    }
  }, [])

  const updateSession = useCallback(async (session: Session) => {
    try {
      await SessionService.UpdateSession({
        id: Number(session.id),
        name: session.name,
        host: session.host,
        port: session.port,
        username: session.username,
        tags: session.tags ?? '', notes: session.notes ?? '', environment: session.environment ?? '', project: session.project ?? '',
        auth_method: session.authMethod as SessionInput['auth_method'],
        password: session.password,
        key_id: session.keyId ? Number(session.keyId) : null,
        keep_alive: session.keepAlive,
        term_type: session.termType,
        folder_id: session.folderId ? Number(session.folderId) : null,
        sort_order: 0,
      } satisfies SessionInput)
      setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('updateSession error', err)
      toast(`更新会话失败: ${msg}`, 'error')
      throw err
    }
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    try {
      await SessionService.DeleteSession(Number(id))
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      logger.error('deleteSession error', err)
    }
  }, [])

  const moveSession = useCallback(async (id: string, folderId: string | null) => {
    try {
      await SessionService.MoveSession(Number(id), folderId ? Number(folderId) : null)
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, folderId } : s)))
    } catch (err) {
      logger.error('moveSession error', err)
    }
  }, [])

  const connect = useCallback(async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return
    const dialog = useConnectDialog.getState()
    if (dialog.open) return void toast('已有 SSH 连接正在处理，请先完成或关闭当前连接窗口', 'info')
    dialog.openDialog(session.host, session.port, session.username, () => { void connect(sessionId) })
    try {
      const terminalId = await openSessionTab(session)
      await Promise.all([listRecentSessions(), listSessions()])
      dialog.setState('connected')
      logger.info('connected', { terminalId, host: session.host })
    } catch (err) {
      logger.error('connect error', err)
      const msg = err instanceof Error ? err.message : String(err)
      dialog.setError(msg)
    }
  }, [listRecentSessions, listSessions, sessions])

  const runBatch = useCallback(async (sessionIDs: string[], command?: string) => {
    const selected = sessionIDs.map((id) => sessions.find((session) => session.id === id)).filter((session): session is Session => session !== undefined)
    const results = await runBatchSessions(selected, command)
    await Promise.all([listRecentSessions(), listSessions()])
    return results
  }, [listRecentSessions, listSessions, sessions])
  const batchConnect = useCallback((sessionIDs: string[]) => runBatch(sessionIDs), [runBatch])
  const batchExecuteMacro = useCallback((sessionIDs: string[], command: string) => runBatch(sessionIDs, command), [runBatch])

  const disconnect = useCallback(async (terminalId: string) => {
    try {
      await TerminalService.Close(terminalId)
      useAppStore.getState().setConnectionStatus(terminalId, 'disconnected')
    } catch (err) {
      logger.error('disconnect error', err)
    }
  }, [])
  const reconnect = useCallback((tabId: string) => reconnectSessionTab(tabId, sessions), [sessions])
  const listTunnels = useCallback(async () => {
    try {
      const result = await TunnelService.List()
      setTunnels((result ?? []).map(mapTunnel))
    } catch (err) {
      logger.error('listTunnels error', err)
    }
  }, [])

  useEffect(() => {
    listFolders()
    listSessions()
    listRecentSessions()
  }, [listFolders, listRecentSessions, listSessions])

  return {
    folders, sessions, recentSessions, tunnels, loading, sessionsLoaded, error,
    listFolders, createFolder, deleteFolder, updateFolder, setDefaultFolder,
    listSessions, listRecentSessions, createSession, updateSession, deleteSession, moveSession,
    connect, batchConnect, batchExecuteMacro, reconnect, disconnect, listTunnels,
  }
}
