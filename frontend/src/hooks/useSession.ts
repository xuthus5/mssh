import { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { SessionService, TerminalService, TunnelService } from '@/lib/wails'
import { useConnectDialog } from '@/store/connectDialog'
import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import type { Session as BindingSession, Tunnel as BindingTunnel } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

export interface Folder {
  id: string
  name: string
  parentId: string | null
  isDefault: boolean
}

export interface Session {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: 'password' | 'key' | 'agent' | 'keyboard-interactive'
  password?: string
  keyId?: string
  keepAlive: number
  termType: string
  folderId: string | null
}

export interface Tunnel {
  id: string
  sessionId: string
  type: 'local' | 'remote' | 'dynamic'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  running: boolean
}

function mapFolder(f: { id: number; name: string; parent_id: number | null; is_default: boolean }): Folder {
  return { id: String(f.id), name: f.name, parentId: f.parent_id ? String(f.parent_id) : null, isDefault: f.is_default }
}

function mapSession(s: BindingSession): Session {
  return {
    id: String(s.id),
    name: s.name,
    host: s.host,
    port: s.port,
    username: s.username,
    authMethod: s.auth_method as Session['authMethod'],
    password: s.password,
    keyId: s.key_id != null ? String(s.key_id) : undefined,
    keepAlive: s.keep_alive,
    termType: s.term_type,
    folderId: s.folder_id != null ? String(s.folder_id) : null,
  }
}

function mapTunnel(t: BindingTunnel): Tunnel {
  return {
    id: String(t.id),
    sessionId: String(t.session_id),
    type: t.type as Tunnel['type'],
    localAddress: t.local_host ?? '',
    localPort: t.local_port,
    remoteAddress: t.remote_host ?? '',
    remotePort: t.remote_port,
    running: false,
  }
}

export function useSession() {
  const openTab = useAppStore((s) => s.openTab)
  const [folders, setFolders] = useState<Folder[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [loading, setLoading] = useState(false)
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
      setFolders((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      logger.error('deleteFolder error', err)
      throw err
    }
  }, [])

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
    }
  }, [])

  const createSession = useCallback(async (session: Omit<Session, 'id'>) => {
    try {
      const result = await SessionService.CreateSession({
        name: session.name,
        host: session.host,
        port: session.port,
        username: session.username,
        auth_method: session.authMethod as BindingSession['auth_method'],
        password: session.password,
        key_id: session.keyId ? Number(session.keyId) : null,
        keep_alive: session.keepAlive,
        term_type: session.termType,
        folder_id: session.folderId ? Number(session.folderId) : null,
        id: 0,
        sort_order: 0,
      } as BindingSession)
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
        auth_method: session.authMethod as BindingSession['auth_method'],
        password: session.password,
        key_id: session.keyId ? Number(session.keyId) : null,
        keep_alive: session.keepAlive,
        term_type: session.termType,
        folder_id: session.folderId ? Number(session.folderId) : null,
        sort_order: 0,
      } as BindingSession)
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
    dialog.openDialog(session.host, session.port, session.username, () => { void connect(sessionId) })

    try {
      const terminalId = await TerminalService.Open(Number(sessionId), 80, 24)
      const tabId = `terminal-${sessionId}`
      useAppStore.getState().setConnectionStatus(terminalId, 'connected')
      openTab({ id: tabId, title: session.name, type: 'terminal', terminalId, sessionId: Number(sessionId) })

      dialog.setState('connected')
      logger.info('connected', { terminalId, host: session.host })
    } catch (err) {
      logger.error('connect error', err)
      const msg = err instanceof Error ? err.message : String(err)
      dialog.setError(msg)
    }
  }, [openTab, sessions])

  const disconnect = useCallback(async (sessionId: string) => {
    try {
      const terminalId = `terminal-${sessionId}`
      await SessionService.Disconnect(terminalId)
      useAppStore.getState().setConnectionStatus(terminalId, 'disconnected')
    } catch (err) {
      logger.error('disconnect error', err)
    }
  }, [])

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
  }, [listFolders, listSessions])

  return {
    folders, sessions, tunnels, loading, error,
    listFolders, createFolder, deleteFolder, updateFolder, setDefaultFolder,
    listSessions, createSession, updateSession, deleteSession, moveSession,
    connect, disconnect, listTunnels,
  }
}
