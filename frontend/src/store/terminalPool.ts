import type { AppState, Tab } from '@/store/appStore'

/** Terminals currently bound to open tabs or the active pane. */
export function protectedTerminalIDs(state: Pick<AppState, 'tabs' | 'activePaneId' | 'activeSurface'>): Set<string> {
  const protectedIDs = new Set<string>()
  if (state.activePaneId) protectedIDs.add(state.activePaneId)
  for (const tab of state.tabs) {
    if (tab.type === 'terminal') protectedIDs.add(tab.terminalId)
  }
  if (state.activeSurface?.type === 'terminal') {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeSurface?.id)
    if (activeTab?.type === 'terminal') protectedIDs.add(activeTab.terminalId)
  }
  return protectedIDs
}

/**
 * Pick a pool victim for LRU eviction.
 * Prefer orphans (not referenced by open terminal tabs), then LRU among non-active-pane terminals.
 */
export function selectTerminalPoolEvictionID(state: AppState): string | null {
  if (state.terminalPool.size === 0) return null
  const protectedIDs = protectedTerminalIDs(state)
  let orphanID = ''
  let orphanTime = Infinity
  let fallbackID = ''
  let fallbackTime = Infinity
  for (const [id, entry] of state.terminalPool) {
    if (id === state.activePaneId) continue
    if (!protectedIDs.has(id) && entry.lastUsed < orphanTime) {
      orphanTime = entry.lastUsed
      orphanID = id
      continue
    }
    if (protectedIDs.has(id) && entry.lastUsed < fallbackTime) {
      fallbackTime = entry.lastUsed
      fallbackID = id
    }
  }
  if (orphanID) return orphanID
  if (fallbackID) return fallbackID
  for (const [id, entry] of state.terminalPool) {
    if (fallbackID === '' || entry.lastUsed < fallbackTime) {
      fallbackTime = entry.lastUsed
      fallbackID = id
    }
  }
  return fallbackID || null
}

export function clearTerminalRuntimeFields(state: AppState, terminalID: string): {
  connectionStatus: AppState['connectionStatus']
  recordingState: AppState['recordingState']
  activePaneId: string | null
} {
  const connectionStatus = { ...state.connectionStatus }
  delete connectionStatus[terminalID]
  const recordingState = { ...state.recordingState }
  delete recordingState[terminalID]
  return {
    connectionStatus,
    recordingState,
    activePaneId: state.activePaneId === terminalID ? null : state.activePaneId,
  }
}

export function findTabByTerminalID(tabs: Tab[], terminalID: string): Tab | undefined {
  return tabs.find((tab) => tab.type === 'terminal' && tab.terminalId === terminalID)
}
