import { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { getWails } from '@/lib/wails'

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
      const wails = getWails()
      console.log('[useSession] listFolders')
      const result = await wails.SessionService.ListFolders()
      setFolders(result.map((f) => ({ id: String(f.id), name: f.name, parentId: f.parent_id ? String(f.parent_id) : null })))
    } catch (err) {
      console.log('[useSession] listFolders error', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const createFolder = useCallback(async (name: string, parentId: string | null) => {
    try {
      const wails = getWails()
      console.log('[useSession] createFolder', { name, parentId })
      const result = await wails.SessionService.CreateFolder(name, parentId ? Number(parentId) : null)
      setFolders((prev) => [...prev, { id: String(result.id), name: result.name, parentId: result.parent_id ? String(result.parent_id) : null }])
    } catch (err) {
      console.log('[useSession] createFolder error', err)
    }
  }, [])

  const deleteFolder = useCallback(async (id: string) => {
    try {
      const wails = getWails()
      console.log('[useSession] deleteFolder', id)
      await wails.SessionService.DeleteFolder(Number(id))
      setFolders((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      console.log('[useSession] deleteFolder error', err)
    }
  }, [])

  const listSessions = useCallback(async () => {
    setLoading(true)
    try {
      const wails = getWails()
      console.log('[useSession] listSessions')
      const result = await wails.SessionService.ListSessions()
      setSessions(result.map((s) => ({
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
      const wails = getWails()
      console.log('[useSession] createSession', { name: session.name, authMethod: session.authMethod })
      const result = await wails.SessionService.CreateSession({
        name: session.name,
        host: session.host,
        port: session.port,
        username: session.username,
        auth_method: session.authMethod,
        password: session.password,
        key_id: session.keyId ? Number(session.keyId) : undefined,
        keep_alive: session.keepAlive,
        term_type: session.termType,
        folder_id: session.folderId ? Number(session.folderId) : null,
      })
      setSessions((prev) => [...prev, {
        id: String(result.id),
        name: result.name,
        host: result.host,
        port: result.port,
        username: result.username,
        authMethod: result.auth_method as Session['authMethod'],
        password: result.password,
        keyId: result.key_id ? String(result.key_id) : undefined,
        keepAlive: result.keep_alive,
        termType: result.term_type,
        folderId: result.folder_id ? String(result.folder_id) : null,
      }])
    } catch (err) {
      console.log('[useSession] createSession error', err)
    }
  }, [])

  const updateSession = useCallback(async (session: Session) => {
    try {
      const wails = getWails()
      console.log('[useSession] updateSession', { id: session.id, name: session.name, authMethod: session.authMethod })
      await wails.SessionService.UpdateSession({
        id: Number(session.id),
        name: session.name,
        host: session.host,
        port: session.port,
        username: session.username,
        auth_method: session.authMethod,
        password: session.password,
        key_id: session.keyId ? Number(session.keyId) : undefined,
        keep_alive: session.keepAlive,
        term_type: session.termType,
        folder_id: session.folderId ? Number(session.folderId) : null,
      })
      setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)))
    } catch (err) {
      console.log('[useSession] updateSession error', err)
    }
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    try {
      const wails = getWails()
      console.log('[useSession] deleteSession', id)
      await wails.SessionService.DeleteSession(Number(id))
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      console.log('[useSession] deleteSession error', err)
    }
  }, [])

  const connect = useCallback(async (sessionId: string) => {
    try {
      const wails = getWails()
      console.log('[useSession] connect', sessionId)
      const terminalId = await wails.SessionService.Connect(Number(sessionId))
      const tabId = `terminal-${sessionId}`
      const session = sessions.find((s) => s.id === sessionId)
      openTab({ id: tabId, title: session?.name ?? sessionId, type: 'terminal', terminalId })

      // Write connection info to terminal after mount
      setTimeout(() => {
        const st = useAppStore.getState().terminalPool.get(terminalId)
        if (st?.terminal && session) {
          st.terminal.writeln(`\x1b[1;32mConnecting to ${session.username}@${session.host}:${session.port}...\x1b[0m`)
        }
      }, 200)
    } catch (err) {
      console.log('[useSession] connect error', err)
    }
  }, [openTab, sessions])

  const disconnect = useCallback(async (sessionId: string) => {
    try {
      const wails = getWails()
      console.log('[useSession] disconnect', sessionId)
      await wails.SessionService.Disconnect(`terminal-${sessionId}`)
    } catch (err) {
      console.log('[useSession] disconnect error', err)
    }
  }, [])

  const listTunnels = useCallback(async (sessionId: string) => {
    try {
      const wails = getWails()
      console.log('[useSession] listTunnels', sessionId)
      const result = await wails.TunnelService.List()
      setTunnels(result as Tunnel[])
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
    listFolders, createFolder, deleteFolder,
    listSessions, createSession, updateSession, deleteSession,
    connect, disconnect, listTunnels,
  }
}
