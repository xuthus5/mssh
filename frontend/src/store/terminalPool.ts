import type { AppState, Tab, TerminalTab } from '@/store/appStore'
import { t } from '@/i18n'


export type TerminalPoolEvictionMode = 'orphan-only' | 'include-protected'

export interface TerminalPoolVictim {
  terminalID: string
  protected: boolean
  owningTab?: TerminalTab
}

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

function pickOldest(ids: Iterable<string>, pool: AppState['terminalPool'], skip?: string): string {
  let chosen = ''
  let oldest = Infinity
  for (const id of ids) {
    if (id === skip) continue
    const entry = pool.get(id)
    if (!entry) continue
    if (entry.lastUsed < oldest) {
      oldest = entry.lastUsed
      chosen = id
    }
  }
  return chosen
}

/**
 * Pick a pool victim for LRU eviction.
 * Prefer orphans (not on open tabs). Optionally allow protected tab-bound terminals.
 * Never prefers the active pane while any other candidate exists.
 */
export function selectTerminalPoolEvictionID(
  state: AppState,
  mode: TerminalPoolEvictionMode = 'include-protected',
): string | null {
  if (state.terminalPool.size === 0) return null
  const protectedIDs = protectedTerminalIDs(state)
  const orphanIDs: string[] = []
  const protectedCandidates: string[] = []
  for (const id of state.terminalPool.keys()) {
    if (id === state.activePaneId) continue
    if (protectedIDs.has(id)) protectedCandidates.push(id)
    else orphanIDs.push(id)
  }
  const orphan = pickOldest(orphanIDs, state.terminalPool)
  if (orphan) return orphan
  if (mode === 'orphan-only') return null
  const protectedVictim = pickOldest(protectedCandidates, state.terminalPool)
  if (protectedVictim) return protectedVictim
  return pickOldest(state.terminalPool.keys(), state.terminalPool) || null
}

export function describeTerminalPoolVictim(state: AppState, terminalID: string): TerminalPoolVictim {
  const owningTab = findTabByTerminalID(state.tabs, terminalID)
  return {
    terminalID,
    protected: protectedTerminalIDs(state).has(terminalID),
    owningTab: owningTab?.type === 'terminal' ? owningTab : undefined,
  }
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

export async function confirmProtectedTerminalReclaim(
  victim: TerminalPoolVictim,
  confirm: (request: { title: string; description: string }) => Promise<boolean> | boolean = defaultProtectedConfirm,
): Promise<boolean> {
  const title = victim.owningTab?.title ?? victim.terminalID
  return confirm({
    title: t('终端池已满'),
    description: t('继续将关闭标签「${}」并断开对应连接，之后可从会话列表重新连接。是否继续？', title),
  })
}

async function defaultProtectedConfirm(request: { title: string; description: string }): Promise<boolean> {
  const { requestConfirm } = await import('@/lib/confirmDialog')
  return requestConfirm({
    title: request.title,
    description: request.description,
    confirmLabel: t('继续'),
    cancelLabel: t('取消'),
    destructive: true,
  })
}
