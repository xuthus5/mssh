import { createContext, useContext, type ReactNode } from 'react'
import { useSession } from '@/hooks/useSession'

type SessionWorkspaceState = ReturnType<typeof useSession>
const SessionWorkspaceContext = createContext<SessionWorkspaceState | null>(null)

export function SessionWorkspaceProvider({ children }: { children: ReactNode }) {
  const state = useSession()
  return <SessionWorkspaceContext.Provider value={state}>{children}</SessionWorkspaceContext.Provider>
}

export function useSessionWorkspace() {
  const state = useContext(SessionWorkspaceContext)
  if (!state) throw new Error('useSessionWorkspace must be used within SessionWorkspaceProvider')
  return state
}
