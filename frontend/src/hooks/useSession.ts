import { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'

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
      console.debug('[Wails:SessionService.ListFolders]')
      // const result = await Wails.SessionService.ListFolders()
      // setFolders(result)
    } finally {
      setLoading(false)
    }
  }, [])

  const createFolder = useCallback(async (name: string, parentId: string | null) => {
    console.debug('[Wails:SessionService.CreateFolder]', name, parentId)
    const newFolder: Folder = {
      id: `folder-${Date.now()}`,
      name,
      parentId,
    }
    setFolders((prev) => [...prev, newFolder])
  }, [])

  const deleteFolder = useCallback(async (id: string) => {
    console.debug('[Wails:SessionService.DeleteFolder]', id)
    // await Wails.SessionService.DeleteFolder(id)
    setFolders((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const listSessions = useCallback(async () => {
    setLoading(true)
    try {
      console.debug('[Wails:SessionService.ListSessions]')
      // const result = await Wails.SessionService.ListSessions()
      // setSessions(result)
    } finally {
      setLoading(false)
    }
  }, [])

  const createSession = useCallback(async (session: Omit<Session, 'id'>) => {
    console.debug('[Wails:SessionService.CreateSession]', session)
    const newSession: Session = {
      ...session,
      id: `session-${Date.now()}`,
    }
    setSessions((prev) => [...prev, newSession])
  }, [])

  const updateSession = useCallback(async (session: Session) => {
    console.debug('[Wails:SessionService.UpdateSession]', session)
    // await Wails.SessionService.UpdateSession(session)
    setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)))
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    console.debug('[Wails:SessionService.DeleteSession]', id)
    // await Wails.SessionService.DeleteSession(id)
    setSessions((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const connect = useCallback(
    async (sessionId: string) => {
      console.debug('[Wails:SessionService.Connect]', sessionId)
      const tabId = `terminal-${sessionId}`
      const session = sessions.find((s) => s.id === sessionId)
      openTab({
        id: tabId,
        title: session?.name ?? sessionId,
        type: 'terminal',
        terminalId: tabId,
      })
    },
    [openTab, sessions],
  )

  const disconnect = useCallback(async (sessionId: string) => {
    console.debug('[Wails:SessionService.Disconnect]', sessionId)
  }, [])

  const listTunnels = useCallback(async (sessionId: string) => {
    console.debug('[Wails:SessionService.ListTunnels]', sessionId)
    // const result = await Wails.SessionService.ListTunnels(sessionId)
    // setTunnels(result)
  }, [])

  const startTunnel = useCallback(async (tunnel: Omit<Tunnel, 'id' | 'running'>) => {
    console.debug('[Wails:SessionService.StartTunnel]', tunnel)
    // const result = await Wails.SessionService.StartTunnel(tunnel)
    // setTunnels((prev) => [...prev, result])
  }, [])

  const stopTunnel = useCallback(async (tunnelId: string) => {
    console.debug('[Wails:SessionService.StopTunnel]', tunnelId)
    // await Wails.SessionService.StopTunnel(tunnelId)
    setTunnels((prev) => prev.map((t) => (t.id === tunnelId ? { ...t, running: false } : t)))
  }, [])

  useEffect(() => {
    listFolders()
    listSessions()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    folders,
    sessions,
    tunnels,
    loading,
    listFolders,
    createFolder,
    deleteFolder,
    listSessions,
    createSession,
    updateSession,
    deleteSession,
    connect,
    disconnect,
    listTunnels,
    startTunnel,
    stopTunnel,
  }
}
