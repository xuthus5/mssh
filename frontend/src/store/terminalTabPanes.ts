import type { AppState, TerminalTab } from '@/store/appStore'

/** All live terminal IDs for a tab (primary + split panes), de-duplicated. */
export function terminalTabPaneIDs(tab: TerminalTab): string[] {
  return [...new Set([tab.terminalId, ...(tab.splitPaneIDs ?? [])])]
}

/** Replace a terminal id inside splitPaneIDs after reconnect/promote. */
export function rewriteSplitPaneIDs(
  paneIDs: string[] | undefined,
  previous: string,
  next: string,
): string[] | undefined {
  if (!paneIDs?.length) return paneIDs
  return [...new Set(paneIDs.map((id) => (id === previous ? next : id)))]
}

/** Drop pool/status/recording entries for closed terminal IDs. */
export function scrubTerminalRuntime(
  state: Pick<AppState, 'terminalPool' | 'connectionStatus' | 'recordingState' | 'activePaneId'>,
  terminalIDs: string[],
): Pick<AppState, 'terminalPool' | 'connectionStatus' | 'recordingState' | 'activePaneId'> {
  const terminalPool = new Map(state.terminalPool)
  const connectionStatus = { ...state.connectionStatus }
  const recordingState = { ...state.recordingState }
  let activePaneId = state.activePaneId
  for (const terminalID of terminalIDs) {
    terminalPool.delete(terminalID)
    delete connectionStatus[terminalID]
    delete recordingState[terminalID]
    if (activePaneId === terminalID) activePaneId = null
  }
  return { terminalPool, connectionStatus, recordingState, activePaneId }
}
