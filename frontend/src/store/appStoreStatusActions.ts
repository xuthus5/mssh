import type { StoreApi } from 'zustand'
import type { AppState } from '@/store/appStore'
import { canTransitionConnection } from '@/store/connectionStatus'

type StoreSet = StoreApi<AppState>['setState']
type StatusActions = Pick<AppState, 'setConnectionStatus' | 'setActivePane' | 'setRecordingState' | 'setTunnelState' | 'setAppStatus' | 'setTerminalTheme' | 'setMaxPoolSize' | 'setWorkspaceRestoreError' | 'setWorkspaceRestoreNotice' | 'setWorkspaceSaveError' | 'setShellActionError' | 'retryWorkspaceRestore'>

export function createStatusActions(set: StoreSet): StatusActions {
  return {
    setConnectionStatus: (id, status) => set((state) => {
      const current = state.connectionStatus[id]
      const shouldReleaseReservation = status === 'disconnected' || status === 'error'
      if (!canTransitionConnection(current, status)) return state
      if (!shouldReleaseReservation) return { connectionStatus: { ...state.connectionStatus, [id]: status } }
      const terminalOpenReservations = new Set(state.terminalOpenReservations ?? [])
      terminalOpenReservations.delete(id)
      return { connectionStatus: { ...state.connectionStatus, [id]: status }, terminalOpenReservations }
    }),
    setActivePane: (activePaneId) => set({ activePaneId }),
    setRecordingState: (id, recording) => set((state) => ({ recordingState: { ...state.recordingState, [id]: recording } })),
    setTunnelState: (id, tunnel) => set((state) => ({ tunnelState: { ...state.tunnelState, [id]: tunnel } })),
    setAppStatus: (appStatus) => set({ appStatus }),
    setTerminalTheme: (terminalTheme) => set({ terminalTheme }),
    setMaxPoolSize: (maxPoolSize) => set({ maxPoolSize }),
    setWorkspaceRestoreError: (workspaceRestoreError) => set({ workspaceRestoreError }),
    setWorkspaceRestoreNotice: (workspaceRestoreNotice) => set({ workspaceRestoreNotice }),
    setWorkspaceSaveError: (workspaceSaveError) => set({ workspaceSaveError }),
    setShellActionError: (shellActionError) => set({ shellActionError }),
    retryWorkspaceRestore: () => set((state) => ({
      workspaceRestoreError: '',
      workspaceRestoreNotice: '',
      workspaceRestoreNonce: state.workspaceRestoreNonce + 1,
    })),
  }
}
