import { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { SessionService, TerminalService, TunnelService } from '@/lib/wails'
import { useConnectDialog } from '@/store/connectDialog'
import { toast } from '@/components/ui/toast'

export interface Folder {
  id: string
  name: string
  parentId: string | null
}

export interface Session {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: 'password' | 'key' | 'agent'
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

export function useSession() {
  const openTab = useAppStore((s) => s.openTab)
  const [folders, setFolders] = useState<Folder[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [loading, setLoading] = useState(false)

  const listFolders = useCallback(async () => {
    setLoading(true)
    try {
      console.log('[useSession] listFolders')
      const result = await SessionService.ListFolders()
      setFolders(result!.map((f: any) => ({ id: String(f.id), name: f.name, parentId: f.parent_id ? String(f.parent_id) : null })))
    } catch (err) {
      console.log('[useSession] listFolders error', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const createFolder = useCallback(async (name: string, parentId: string | null) => {
    try {
      console.log('[useSession] createFolder', { name, parentId })
      const result = await SessionService.CreateFolder(name, parentId ? Number(parentId) : null)
      setFolders((prev) => [...prev, { id: String(result!.id), name: result!.name, parentId: result!.parent_id ? String(result!.parent_id) : null }])
    } catch (err) {
      console.log('[useSession] createFolder error', err)
    }
  }, [])

  const deleteFolder = useCallback(async (id: string) => {
    try {
      console.log('[useSession] deleteFolder', id)
      await SessionService.DeleteFolder(Number(id))
      setFolders((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      console.log('[useSession] deleteFolder error', err)
    }
  }, [])

  const updateFolder = useCallback(async (id: string, name: string) => {
    try {
      console.log('[useSession] updateFolder', id, name)
      await SessionService.UpdateFolder(Number(id), name)
      setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)))
    } catch (err) {
      console.log('[useSession] updateFolder error', err)
    }
  }, [])

  const listSessions = useCallback(async () => {
    setLoading(true)
    try {
      console.log('[useSession] listSessions')
      const result = await SessionService.ListSessions(null)
      setSessions(result!.map((s: any) => ({
        id: String(s.id),
        name: s.name,
        host: s.host,
        port: s.port,
        username: s.username,
        authMethod: s.auth_method as Session['authMethod'],
        password: s.password,
        keyId: s.key_id ? String(s.key_id) : undefined,
        keepAlive: s.keep_alive,
        termType: s.term_type,
        folderId: s.folder_id ? String(s.folder_id) : null,
      })))
    } catch (err) {
      console.log('[useSession] listSessions error', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const createSession = useCallback(async (session: Omit<Session, 'id'>) => {
    try {
      console.log('[useSession] createSession', {
        name: session.name,
        authMethod: session.authMethod,
        passwordLen: session.password?.length ?? 0,
        host: session.host,
      })
      const result = await SessionService.CreateSession({
        name: session.name,
        host: session.host,
        port: session.port,
        username: session.username,
        auth_method: session.authMethod as any,
        password: session.password,
        key_id: session.keyId ? Number(session.keyId) : null,
        keep_alive: session.keepAlive,
        term_type: session.termType,
        folder_id: session.folderId ? Number(session.folderId) : null,
        id: 0,
        sort_order: 0,
      } as any)
      setSessions((prev) => [...prev, {
        id: String(result!.id),
        name: result!.name,
        host: result!.host,
        port: result!.port,
        username: result!.username,
        authMethod: result!.auth_method as Session['authMethod'],
        password: result!.password,
        keyId: result!.key_id ? String(result!.key_id) : undefined,
        keepAlive: result!.keep_alive,
        termType: result!.term_type,
        folderId: result!.folder_id ? String(result!.folder_id) : null,
      }])
    } catch (err: any) {
      console.log('[useSession] createSession error', err)
      toast(`创建会话失败: ${err?.message || err}`, 'error')
    }
  }, [])

  const updateSession = useCallback(async (session: Session) => {
    try {
      console.log('[useSession] updateSession', {
        id: session.id,
        name: session.name,
        authMethod: session.authMethod,
        passwordLen: session.password?.length ?? 0,
        host: session.host,
      })
      await SessionService.UpdateSession({
        id: Number(session.id),
        name: session.name,
        host: session.host,
        port: session.port,
        username: session.username,
        auth_method: session.authMethod as any,
        password: session.password,
        key_id: session.keyId ? Number(session.keyId) : null,
        keep_alive: session.keepAlive,
        term_type: session.termType,
        folder_id: session.folderId ? Number(session.folderId) : null,
        sort_order: 0,
      } as any)

      setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)))
    } catch (err: any) {
      console.log('[useSession] updateSession error', err)
      toast(`更新会话失败: ${err?.message || err}`, 'error')
    }
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    try {
      console.log('[useSession] deleteSession', id)
      await SessionService.DeleteSession(Number(id))
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      console.log('[useSession] deleteSession error', err)
    }
  }, [])

  const moveSession = useCallback(async (id: string, folderId: string | null) => {
    try {
      console.log('[useSession] moveSession', id, folderId)
      await SessionService.MoveSession(Number(id), folderId ? Number(folderId) : null)
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, folderId } : s)))
    } catch (err) {
      console.log('[useSession] moveSession error', err)
    }
  }, [])

  const connect = useCallback(async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return

    const dialog = useConnectDialog.getState()
    dialog.openDialog(session.host, session.port, session.username)

    try {
      console.log('[useSession] connect', sessionId)
      // TerminalService.Open does SSH connect + PTY open in one call
      const terminalId = await TerminalService.Open(Number(sessionId), 80, 24)
      const tabId = `terminal-${sessionId}`
      useAppStore.getState().setConnectionStatus(terminalId, 'connecting')
      openTab({ id: tabId, title: session.name, type: 'terminal', terminalId, sessionId: Number(sessionId) })

      dialog.setState('connected')
      setTimeout(() => {
        useAppStore.getState().setConnectionStatus(terminalId, 'connected')
        console.log('[useSession] connected', { terminalId, host: session.host })
      }, 500)
    } catch (err: any) {
      console.log('[useSession] connect error', err)
      const msg = err?.message || String(err)
      dialog.setError(msg)
    }
  }, [openTab, sessions])

  const disconnect = useCallback(async (sessionId: string) => {
    try {
      const terminalId = `terminal-${sessionId}`
      console.log('[useSession] disconnect', sessionId)
      await SessionService.Disconnect(terminalId)
      useAppStore.getState().setConnectionStatus(terminalId, 'disconnected')
    } catch (err) {
      console.log('[useSession] disconnect error', err)
    }
  }, [])

  const listTunnels = useCallback(async (_sessionId: string) => {
    try {
      console.log('[useSession] listTunnels', _sessionId)
      const result = await TunnelService.List()
      setTunnels(result as unknown as Tunnel[])
    } catch (err) {
      console.log('[useSession] listTunnels error', err)
    }
  }, [])

  useEffect(() => {
    listFolders()
    listSessions()
  }, [listFolders, listSessions])

  return {
    folders, sessions, tunnels, loading,
    listFolders, createFolder, deleteFolder, updateFolder,
    listSessions, createSession, updateSession, deleteSession, moveSession,
    connect, disconnect, listTunnels,
  }
}
