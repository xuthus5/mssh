import type { StoreApi } from 'zustand'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import {
  fallbackAfterClose,
  isTerminalNotFoundError,
  persistNavigationCollapsed,
  persistSidebarWidth,
  surfaceForTab,
  type ActiveSurface,
  type OverviewSection,
  type WorkspaceID,
} from '@/store/tabNavigation'
import type { AppState, Tab } from '@/store/appStore'
import { selectTerminalPoolEvictionID } from '@/store/terminalPool'
import { applyTerminalPoolEviction } from '@/store/terminalPoolReclaim'
import { markIntentionalDisconnect } from '@/hooks/sessionReconnect'
import { rewriteSplitPaneIDs, scrubTerminalRuntime, terminalTabPaneIDs } from '@/store/terminalTabPanes'

type StoreSet = StoreApi<AppState>['setState']
type StoreGet = StoreApi<AppState>['getState']
type TransferActions = Pick<AppState, 'addTransfer' | 'removeTransfer' | 'updateTransfer' | 'clearFinishedTransfers' | 'setTransfersLoadError' | 'setTransferCenterOpen'>
type TabActions = Pick<AppState, 'openTab' | 'closeTab' | 'removeTabLocal' | 'replaceTerminalConnection' | 'promoteTerminalConnection' | 'updateTerminalWorkspace'>
type NavigationActions = Pick<AppState, 'activateWorkspace' | 'setOverviewSection' | 'leaveOverview' | 'activateTab' | 'requestTerminalFocus' | 'toggleNavigation' | 'setSidebarWidth'>
type PoolActions = Pick<AppState, 'registerTerminal' | 'unregisterTerminal' | 'forgetTerminal' | 'updateLastUsed' | 'evictLRU'>
function workspaceTabForSurface(activeSurface: ActiveSurface | null, workspaceTab: WorkspaceID): WorkspaceID {
  return activeSurface?.type === 'workspace' ? activeSurface.id : workspaceTab
}

function openTabState(state: AppState, tab: Tab): Partial<AppState> {
  const existing = state.tabs.find((item) => item.id === tab.id)
  if (existing) return { activeSurface: surfaceForTab(existing) }
  return { tabs: [...state.tabs, tab], activeSurface: surfaceForTab(tab) }
}

async function closeTerminalPane(terminalID: string) {
  try {
    await TerminalService.Close(terminalID)
  } catch (error: unknown) {
    if (!isTerminalNotFoundError(error)) {
      logger.error('closeTab: close terminal error', error)
      throw error
    }
  }
}

async function closeTab(get: StoreGet, id: string) {
  const tab = get().tabs.find((item) => item.id === id)
  if (tab?.type === 'terminal') {
    const paneIDs = terminalTabPaneIDs(tab)
    for (const paneID of paneIDs) markIntentionalDisconnect(paneID)
    for (const paneID of paneIDs) await closeTerminalPane(paneID)
  }
  get().removeTabLocal(id)
}

function removeTabState(state: AppState, id: string): Partial<AppState> {
  const tab = state.tabs.find((item) => item.id === id)
  const paneIDs = tab?.type === 'terminal' ? terminalTabPaneIDs(tab) : []
  const activeSurface = state.activeSurface?.id === id ? fallbackAfterClose(state.tabs, id) : state.activeSurface
  const workspaceTab = workspaceTabForSurface(activeSurface, state.workspaceTab)
  const tabs = state.tabs.filter((item) => item.id !== id)
  if (paneIDs.length === 0) return { tabs, activeSurface, workspaceTab }
  return { tabs, ...scrubTerminalRuntime(state, paneIDs), activeSurface, workspaceTab }
}

function replaceTerminalConnectionState(state: AppState, tabID: string, previousTerminalID: string, nextTerminalID: string): Partial<AppState> {
  const tab = state.tabs.find((item) => item.id === tabID)
  if (tab?.type !== 'terminal' || tab.terminalId !== previousTerminalID) return {}
  const terminalPool = new Map(state.terminalPool)
  const terminalEntry = terminalPool.get(previousTerminalID)
  terminalPool.delete(previousTerminalID)
  if (terminalEntry) terminalPool.set(nextTerminalID, terminalEntry)
  const connectionStatus = { ...state.connectionStatus }
  delete connectionStatus[previousTerminalID]
  connectionStatus[nextTerminalID] = state.connectionStatus[nextTerminalID] ?? 'connected'
  const recordingState = { ...state.recordingState }
  delete recordingState[previousTerminalID]
  const active = state.activeSurface?.type === 'terminal' && state.activeSurface.id === tabID
  const splitPaneIDs = rewriteSplitPaneIDs(tab.splitPaneIDs, previousTerminalID, nextTerminalID)
  return {
    tabs: state.tabs.map((item) => item.id === tabID && item.type === 'terminal'
      ? { ...item, terminalId: nextTerminalID, ...(splitPaneIDs !== undefined ? { splitPaneIDs } : {}) }
      : item),
    terminalPool,
    connectionStatus,
    recordingState,
    activePaneId: state.activePaneId === previousTerminalID ? nextTerminalID : state.activePaneId,
    focusRequest: active
      ? { id: tabID, terminalId: nextTerminalID, sequence: state.focusRequest.sequence + 1 }
      : state.focusRequest,
  }
}

function promoteTerminalConnectionState(state: AppState, tabID: string, previousTerminalID: string, nextTerminalID: string): Partial<AppState> {
  const tab = state.tabs.find((item) => item.id === tabID)
  if (tab?.type !== 'terminal' || tab.terminalId !== previousTerminalID) return {}
  const terminalPool = new Map(state.terminalPool)
  terminalPool.delete(previousTerminalID)
  const connectionStatus = { ...state.connectionStatus }
  delete connectionStatus[previousTerminalID]
  const recordingState = { ...state.recordingState }
  delete recordingState[previousTerminalID]
  const splitPaneIDs = rewriteSplitPaneIDs(tab.splitPaneIDs, previousTerminalID, nextTerminalID)
  return {
    tabs: state.tabs.map((item) => item.id === tabID && item.type === 'terminal'
      ? { ...item, terminalId: nextTerminalID, ...(splitPaneIDs !== undefined ? { splitPaneIDs } : {}) }
      : item),
    terminalPool,
    connectionStatus,
    recordingState,
    activePaneId: state.activePaneId === previousTerminalID ? nextTerminalID : state.activePaneId,
  }
}

function activateTab(set: StoreSet, get: StoreGet, id: string, focus: boolean) {
  const state = get()
  const tab = state.tabs.find((item) => item.id === id)
  if (!tab) return
  if (focus && tab.type === 'terminal') {
    const primaryID = tab.terminalId
    const returningToSameTab = state.activeSurface?.id === id || state.focusRequest.id === id
    state.requestTerminalFocus(id, returningToSameTab ? state.activePaneId ?? primaryID : primaryID)
    return
  }
  set((current) => ({
    activeSurface: surfaceForTab(tab),
    focusRequest: focus
      ? { id, terminalId: null, sequence: current.focusRequest.sequence + 1 }
      : current.focusRequest,
  }))
}

function requestTerminalFocusState(state: AppState, tabID: string, terminalID: string): Partial<AppState> {
  const tab = state.tabs.find((item) => item.id === tabID && item.type === 'terminal')
  if (!tab) return {}
  return {
    activeSurface: surfaceForTab(tab),
    activePaneId: terminalID,
    focusRequest: { id: tabID, terminalId: terminalID, sequence: state.focusRequest.sequence + 1 },
  }
}

export function createTransferActions(set: StoreSet): TransferActions {
  return {
    addTransfer: (job) => set((state) => ({ transfers: [...state.transfers, job], transferCenterOpen: true, transfersLoadError: '' })),
    removeTransfer: (id) => set((state) => ({ transfers: state.transfers.filter((transfer) => transfer.id !== id) })),
    updateTransfer: (id, updates) => set((state) => ({ transfers: state.transfers.map((transfer) => transfer.id === id ? { ...transfer, ...updates } : transfer) })),
    clearFinishedTransfers: () => set((state) => ({ transfers: state.transfers.filter((transfer) => transfer.status === 'queued' || transfer.status === 'running') })),
    setTransfersLoadError: (transfersLoadError) => set({ transfersLoadError }),
    setTransferCenterOpen: (transferCenterOpen) => set({ transferCenterOpen }),
  }
}

export function createTabActions(set: StoreSet, get: StoreGet): TabActions {
  return {
    openTab: (tab) => set((state) => openTabState(state, tab)),
    closeTab: (id) => closeTab(get, id),
    removeTabLocal: (id) => set((state) => removeTabState(state, id)),
    replaceTerminalConnection: (tabID, previousTerminalID, nextTerminalID) => {
      let replaced = false
      set((state) => {
        const updates = replaceTerminalConnectionState(state, tabID, previousTerminalID, nextTerminalID)
        replaced = Object.keys(updates).length > 0
        return updates
      })
      return replaced
    },
    promoteTerminalConnection: (tabID, previousTerminalID, nextTerminalID) => {
      let promoted = false
      set((state) => {
        const updates = promoteTerminalConnectionState(state, tabID, previousTerminalID, nextTerminalID)
        promoted = Object.keys(updates).length > 0
        return updates
      })
      return promoted
    },
    updateTerminalWorkspace: (tabID, updates) => set((state) => ({
      tabs: state.tabs.map((tab) => tab.id === tabID && tab.type === 'terminal' ? { ...tab, ...updates } : tab),
    })),
  }
}

export function createNavigationActions(set: StoreSet, get: StoreGet): NavigationActions {
  return {
    activateWorkspace: (id) => set((state) => activateWorkspaceState(state, id)),
    setOverviewSection: (overviewSection: OverviewSection) => set({ overviewSection }),
    leaveOverview: () => set((state) => leaveOverviewState(state)),
    activateTab: (id, focus = false) => activateTab(set, get, id, focus),
    requestTerminalFocus: (tabID, terminalID) => set((state) => requestTerminalFocusState(state, tabID, terminalID)),
    toggleNavigation: () => set((state) => {
      const navigationCollapsed = !state.navigationCollapsed
      persistNavigationCollapsed(navigationCollapsed)
      return { navigationCollapsed }
    }),
    setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: persistSidebarWidth(sidebarWidth) }),
  }
}

function activateWorkspaceState(state: AppState, id: WorkspaceID): Partial<AppState> {
  if (id === 'overview') {
    if (state.activeSurface?.type === 'workspace' && state.activeSurface.id === 'overview') return {}
    return { activeSurface: { type: 'workspace', id }, overviewReturnSurface: state.activeSurface }
  }
  if (state.activeSurface === null) return { activeSurface: { type: 'workspace', id }, workspaceTab: id }
  return { workspaceTab: id }
}

function leaveOverviewState(state: AppState): Partial<AppState> {
  if (state.activeSurface?.type !== 'workspace' || state.activeSurface.id !== 'overview') return {}
  const target = state.overviewReturnSurface
  if (target && target.type !== 'workspace' && !state.tabs.some((tab) => tab.id === target.id)) {
    return { activeSurface: null, overviewReturnSurface: null }
  }
  return { activeSurface: target?.type === 'workspace' && target.id === 'overview' ? null : target, overviewReturnSurface: null }
}

function evictLRUState(state: AppState): Partial<AppState> {
  const victimID = selectTerminalPoolEvictionID(state)
  if (!victimID) return {}
  return applyTerminalPoolEviction(state, victimID)
}

export function createPoolActions(set: StoreSet, get: StoreGet): PoolActions {
  return {
    registerTerminal: (id, terminal) => {
      const current = get()
      if (!current.terminalPool.has(id) && current.terminalPool.size >= current.maxPoolSize) {
        // Defensive only: Open path already reserved capacity. Force reclaim if races left the pool full.
        const victimID = selectTerminalPoolEvictionID(current)
        if (victimID) set(applyTerminalPoolEviction(current, victimID))
      }
      set((state) => {
        const terminalPool = new Map(state.terminalPool)
        terminalPool.set(id, { terminal, lastUsed: Date.now() })
        return { terminalPool }
      })
    },
    unregisterTerminal: (id) => set((state) => {
      const terminalPool = new Map(state.terminalPool)
      terminalPool.delete(id)
      return { terminalPool }
    }),
    forgetTerminal: (id) => set((state) => {
      const terminalPool = new Map(state.terminalPool)
      terminalPool.delete(id)
      const connectionStatus = { ...state.connectionStatus }
      delete connectionStatus[id]
      const recordingState = { ...state.recordingState }
      delete recordingState[id]
      return {
        terminalPool,
        connectionStatus,
        recordingState,
        activePaneId: state.activePaneId === id ? null : state.activePaneId,
      }
    }),
    updateLastUsed: (id) => set((state) => {
      const entry = state.terminalPool.get(id)
      if (!entry) return {}
      const terminalPool = new Map(state.terminalPool)
      terminalPool.set(id, { ...entry, lastUsed: Date.now() })
      return { terminalPool }
    }),
    evictLRU: () => set(evictLRUState),
  }
}

export { createStatusActions } from '@/store/appStoreStatusActions'
export { canTransitionConnection } from '@/store/connectionStatus'
