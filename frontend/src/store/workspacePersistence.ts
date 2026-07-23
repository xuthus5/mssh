import type { AppState, ConnectionStatus, Tab, TerminalTab } from '@/store/appStore'
import type { ActiveSurface, OverviewSection, WorkspaceID } from '@/store/tabNavigation'
import { isSplitLayoutSnapshot, type SplitLayoutSnapshot } from '@/components/terminal/splitLayout'

export const WORKSPACE_LAYOUT_SETTING = 'workspace.layout'
export const WORKSPACE_LAYOUT_VERSION = 3

export type TerminalConnectionKind = 'ssh' | 'serial' | 'local'

export type OpenTerminalIntent = {
  connectionKind: TerminalConnectionKind
  sessionId: number
  serialPortId?: number
  title: string
}

type TerminalIntent = {
  type: 'terminal'
  title: string
  sessionId: number
  terminalInstance?: number
  toolPanel?: TerminalTab['toolPanel']
  connectionKind?: TerminalConnectionKind
  serialPortId?: number
  splitLayout?: SplitLayoutSnapshot | null
}
type PlaybackIntent = { type: 'playback'; title: string; recordingPath: string }
type TabIntent = TerminalIntent | PlaybackIntent

export interface WorkspaceSnapshot {
  version: 3
  tabs: TabIntent[]
  active: { type: 'workspace'; id: WorkspaceID } | { type: 'tab'; index: number } | null
  workspaceTab: WorkspaceID
  overviewSection: OverviewSection
}

export interface RestoredWorkspace {
  tabs: Tab[]
  activeSurface: ActiveSurface | null
  workspaceTab: WorkspaceID
  overviewSection: OverviewSection
  activePaneId: string | null
  connectionStatus: Record<string, ConnectionStatus>
  failures: number
}


function sanitizeToolPanelForConnection(
  kind: TerminalConnectionKind | undefined,
  toolPanel: TerminalTab['toolPanel'] | undefined,
): TerminalTab['toolPanel'] | undefined {
  if (!toolPanel) return toolPanel
  if (kind === 'local' || kind === 'serial') {
    if (toolPanel === 'files' || toolPanel === 'system' || toolPanel === 'ai') return null
  }
  return toolPanel
}

export function createWorkspaceSnapshot(state: Pick<AppState, 'tabs' | 'activeSurface' | 'workspaceTab' | 'overviewSection'>): WorkspaceSnapshot {
  const activeIndex = state.activeSurface && state.activeSurface.type !== 'workspace'
    ? state.tabs.findIndex((tab) => tab.id === state.activeSurface?.id)
    : -1
  return {
    version: WORKSPACE_LAYOUT_VERSION,
    tabs: state.tabs.map(tabIntent),
    active: state.activeSurface?.type === 'workspace'
      ? state.activeSurface
      : activeIndex >= 0 ? { type: 'tab', index: activeIndex } : null,
    workspaceTab: state.workspaceTab,
    overviewSection: state.overviewSection,
  }
}

function tabIntent(tab: Tab): TabIntent {
  if (tab.type === 'playback') return { type: 'playback', title: tab.title, recordingPath: tab.recordingPath }
  const intent: TerminalIntent = {
    type: 'terminal',
    title: tab.title,
    sessionId: tab.sessionId,
    terminalInstance: tab.terminalInstance,
    toolPanel: sanitizeToolPanelForConnection(tab.connectionKind, tab.toolPanel) ?? null,
  }
  if (tab.connectionKind === 'local' || tab.connectionKind === 'serial') {
    intent.connectionKind = tab.connectionKind
  }
  if (tab.connectionKind === 'serial' && tab.serialPortId) {
    intent.serialPortId = tab.serialPortId
  }
  // Serial is device-exclusive: never persist multi-pane layouts.
  if (tab.connectionKind !== 'serial' && tab.splitLayout && tab.splitLayout.paneCount > 1) {
    intent.splitLayout = tab.splitLayout
  }
  return intent
}

export function parseWorkspaceSnapshot(raw: string): WorkspaceSnapshot {
  const value: unknown = JSON.parse(raw)
  if (!isWorkspaceSnapshot(value)) throw new Error('workspace layout is invalid')
  return value
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (!isRecord(value) || value.version !== WORKSPACE_LAYOUT_VERSION || !Array.isArray(value.tabs)) return false
  if (!isWorkspaceID(value.workspaceTab) || !isOverviewSection(value.overviewSection) || !isActive(value.active, value.tabs.length)) return false
  return value.tabs.length <= 32 && value.tabs.every(isTabIntent)
}

function isTabIntent(value: unknown): value is TabIntent {
  if (!isRecord(value) || typeof value.title !== 'string' || value.title.length === 0) return false
  if (value.type === 'playback') return typeof value.recordingPath === 'string' && value.recordingPath.length > 0
  if (value.type !== 'terminal' || !Number.isSafeInteger(value.sessionId) || Number(value.sessionId) < 0) return false
  if (value.terminalInstance !== undefined && !Number.isSafeInteger(value.terminalInstance)) return false
  if (value.toolPanel !== undefined && value.toolPanel !== null
    && value.toolPanel !== 'files' && value.toolPanel !== 'history'
    && value.toolPanel !== 'system' && value.toolPanel !== 'ai') {
    return false
  }
  const kind = value.connectionKind
  if (kind === undefined || kind === 'ssh') return Number(value.sessionId) > 0
  if (kind === 'local') return Number(value.sessionId) === 0
  if (value.splitLayout !== undefined && value.splitLayout !== null && !isSplitLayoutSnapshot(value.splitLayout)) {
    return false
  }
  if (kind === 'serial') {
    // Serial tabs must remain single-pane.
    if (value.splitLayout) return false
    return Number(value.sessionId) === 0
      && Number.isSafeInteger(value.serialPortId)
      && Number(value.serialPortId) > 0
  }
  return false
}

function isActive(value: unknown, tabCount: number): value is WorkspaceSnapshot['active'] {
  if (value === null) return true
  if (!isRecord(value)) return false
  if (value.type === 'workspace') return isWorkspaceID(value.id)
  return value.type === 'tab' && Number.isSafeInteger(value.index) && Number(value.index) >= 0 && Number(value.index) < tabCount
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isWorkspaceID = (value: unknown): value is WorkspaceID => value === 'overview' || value === 'sessions' || value === 'macros'
const isOverviewSection = (value: unknown): value is OverviewSection => value === 'sessions' || value === 'keys' || value === 'tunnels' || value === 'serial' || value === 'audit'

export async function restoreWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  sessionIDs: Set<number>,
  openTerminal: (intent: OpenTerminalIntent) => Promise<string>,
  serialPortIDs: Set<number> = new Set(),
): Promise<RestoredWorkspace> {
  const restored = await restoreTabIntents(snapshot.tabs, sessionIDs, serialPortIDs, openTerminal)
  const tabs = restored.map((tab) => tab ?? undefined).filter((tab): tab is Tab => tab !== undefined)
  const activeTab = snapshot.active?.type === 'tab' ? restored[snapshot.active.index] : undefined
  const activeSurface = snapshot.active?.type === 'workspace'
    ? snapshot.active
    : activeTab ? { type: activeTab.type, id: activeTab.id } : tabs.length > 0 ? { type: tabs[0].type, id: tabs[0].id } : null
  const activeTerminal = activeSurface?.type === 'terminal'
    ? tabs.find((tab): tab is TerminalTab => tab.type === 'terminal' && tab.id === activeSurface.id)
    : undefined
  const activePaneId = activeTerminal?.terminalId ?? null
  const connectionStatus = Object.fromEntries(
    tabs.filter((tab): tab is TerminalTab => tab.type === 'terminal').map((tab) => [tab.terminalId, 'connected' as const]),
  )
  return {
    tabs,
    activeSurface,
    workspaceTab: snapshot.workspaceTab,
    overviewSection: snapshot.overviewSection,
    activePaneId,
    connectionStatus,
    failures: restored.filter((tab) => tab === null).length,
  }
}

async function restoreTabIntents(
  intents: TabIntent[],
  sessionIDs: Set<number>,
  serialPortIDs: Set<number>,
  openTerminal: (intent: OpenTerminalIntent) => Promise<string>,
): Promise<Array<Tab | null>> {
  const results: Array<Tab | null> = Array.from({ length: intents.length }, () => null)
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < intents.length) {
      const index = nextIndex++
      results[index] = await restoreTabIntent(intents[index], sessionIDs, serialPortIDs, openTerminal)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, intents.length) }, worker))
  return results
}

async function restoreTabIntent(
  intent: TabIntent,
  sessionIDs: Set<number>,
  serialPortIDs: Set<number>,
  openTerminal: (intent: OpenTerminalIntent) => Promise<string>,
): Promise<Tab | null> {
  if (intent.type === 'playback') return { id: `playback-restored-${crypto.randomUUID()}`, ...intent }
  const kind: TerminalConnectionKind = intent.connectionKind === 'local' || intent.connectionKind === 'serial'
    ? intent.connectionKind
    : 'ssh'
  if (kind === 'ssh' && !sessionIDs.has(intent.sessionId)) return null
  if (kind === 'serial' && (!intent.serialPortId || !serialPortIDs.has(intent.serialPortId))) return null
  try {
    const terminalId = await openTerminal({
      connectionKind: kind,
      sessionId: intent.sessionId,
      serialPortId: intent.serialPortId,
      title: intent.title,
    })
    const tab: TerminalTab = {
      id: `terminal-${terminalId}`,
      title: intent.title,
      type: 'terminal',
      terminalId,
      sessionId: intent.sessionId,
      terminalInstance: intent.terminalInstance,
      toolPanel: sanitizeToolPanelForConnection(kind, intent.toolPanel) ?? null,
    }
    if (kind === 'local') tab.connectionKind = 'local'
    if (kind === 'serial') {
      tab.connectionKind = 'serial'
      tab.serialPortId = intent.serialPortId
    }
    if (kind !== 'serial' && intent.splitLayout && isSplitLayoutSnapshot(intent.splitLayout)) {
      tab.splitLayout = intent.splitLayout
    }
    return tab
  } catch {
    return null
  }
}
