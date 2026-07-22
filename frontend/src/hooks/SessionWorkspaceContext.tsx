import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useSession } from '@/hooks/useSession'
import { setReconnectSessionProvider } from '@/store/eventBridge'

type SessionWorkspaceState = ReturnType<typeof useSession>
const SessionWorkspaceContext = createContext<SessionWorkspaceState | null>(null)

export function SessionWorkspaceProvider({ children }: { children: ReactNode }) {
  const state = useSession()
  useEffect(() => {
    setReconnectSessionProvider(() =>
      state.sessions.map((session) => ({
        id: session.id,
        host: session.host,
        port: session.port,
        username: session.username,
      })),
    )
    return () => setReconnectSessionProvider(null)
  }, [state.sessions])
  return <SessionWorkspaceContext.Provider value={state}>{children}</SessionWorkspaceContext.Provider>
}

export function useSessionWorkspace() {
  const state = useContext(SessionWorkspaceContext)
  if (!state) throw new Error('useSessionWorkspace must be used within SessionWorkspaceProvider')
  return state
}
