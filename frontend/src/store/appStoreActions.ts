import type { StoreApi } from 'zustand'
import type { Terminal } from '@xterm/xterm'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import {
  fallbackAfterClose,
  isTerminalNotFoundError,
  persistNavigationCollapsed,
  persistSidebarWidth,
  surfaceForTab,
  type ActiveSurface,
  type WorkspaceID,
} from '@/store/tabNavigation'
import type { AppState, Tab } from '@/store/appStore'

type StoreSet = StoreApi<AppState>['setState']
type StoreGet = StoreApi<AppState>['getState']
type TransferActions = Pick<AppState, 'addTransfer' | 'removeTransfer' | 'updateTransfer' | 'clearFinishedTransfers' | 'setTransferCenterOpen'>
type TabActions = Pick<AppState, 'openTab' | 'closeTab' | 'removeTabLocal' | 'replaceTerminalConnection'>
type NavigationActions = Pick<AppState, 'activateWorkspace' | 'activateTab' | 'requestTerminalFocus' | 'toggleNavigation' | 'setSidebarWidth'>
type PoolActions = Pick<AppState, 'registerTerminal' | 'unregisterTerminal' | 'updateLastUsed' | 'evictLRU'>
type StatusActions = Pick<AppState, 'setConnectionStatus' | 'setActivePane' | 'setRecordingState' | 'setTunnelState' | 'setAppStatus' | 'setTerminalTheme' | 'setMaxPoolSize'>

function workspaceTabForSurface(activeSurface: ActiveSurface | null, workspaceTab: WorkspaceID): WorkspaceID {
  return activeSurface?.type === 'workspace' ? activeSurface.id : workspaceTab
}

function openTabState(state: AppState, tab: Tab): Partial<AppState> {
  const existing = state.tabs.find((item) => item.id === tab.id)
  if (existing) return { activeSurface: surfaceForTab(existing) }
  return { tabs: [...state.tabs, tab], activeSurface: surfaceForTab(tab) }
}

async function closeTab(get: StoreGet, id: string) {
  const tab = get().tabs.find((item) => item.id === id)
  if (tab?.type === 'terminal') {
    try {
      await TerminalService.Close(tab.terminalId)
    } catch (error: unknown) {
      if (!isTerminalNotFoundError(error)) {
        logger.error('closeTab: close terminal error', error)
        throw error
      }
    }
  }
  get().removeTabLocal(id)
}

function removeTabState(state: AppState, id: string): Partial<AppState> {
  const tab = state.tabs.find((item) => item.id === id)
  const terminalID = tab?.type === 'terminal' ? tab.terminalId : undefined
  const activeSurface = state.activeSurface?.id === id ? fallbackAfterClose(state.tabs, id) : state.activeSurface
  const workspaceTab = workspaceTabForSurface(activeSurface, state.workspaceTab)
  const tabs = state.tabs.filter((item) => item.id !== id)
  if (!terminalID) return { tabs, activeSurface, workspaceTab }
  const terminalPool = new Map(state.terminalPool)
  terminalPool.delete(terminalID)
  const connectionStatus = { ...state.connectionStatus }
  delete connectionStatus[terminalID]
  const recordingState = { ...state.recordingState }
  delete recordingState[terminalID]
  return {
    tabs,
    terminalPool,
    connectionStatus,
    recordingState,
    activePaneId: state.activePaneId === terminalID ? null : state.activePaneId,
    activeSurface,
    workspaceTab,
  }
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
  return {
    tabs: state.tabs.map((item) => item.id === tabID && item.type === 'terminal' ? { ...item, terminalId: nextTerminalID } : item),
    terminalPool,
    connectionStatus,
    recordingState,
    activePaneId: state.activePaneId === previousTerminalID ? nextTerminalID : state.activePaneId,
    focusRequest: active
      ? { id: tabID, terminalId: nextTerminalID, sequence: state.focusRequest.sequence + 1 }
      : state.focusRequest,
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
    addTransfer: (job) => set((state) => ({ transfers: [...state.transfers, job], transferCenterOpen: true })),
    removeTransfer: (id) => set((state) => ({ transfers: state.transfers.filter((transfer) => transfer.id !== id) })),
    updateTransfer: (id, updates) => set((state) => ({ transfers: state.transfers.map((transfer) => transfer.id === id ? { ...transfer, ...updates } : transfer) })),
    clearFinishedTransfers: () => set((state) => ({ transfers: state.transfers.filter((transfer) => transfer.status === 'queued' || transfer.status === 'running') })),
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
  }
}

export function createNavigationActions(set: StoreSet, get: StoreGet): NavigationActions {
  return {
    activateWorkspace: (id) => set((state) => (
      id === 'macros' && state.activeSurface?.type === 'terminal'
        ? { workspaceTab: id }
        : { activeSurface: { type: 'workspace', id }, workspaceTab: id }
    )),
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

function registerTerminalState(state: AppState, get: StoreGet, id: string, terminal: Terminal): Partial<AppState> {
  const terminalPool = new Map(state.terminalPool)
  if (terminalPool.size >= state.maxPoolSize) {
    get().evictLRU()
    const current = new Map(get().terminalPool)
    current.set(id, { terminal, lastUsed: Date.now() })
    return { terminalPool: current }
  }
  terminalPool.set(id, { terminal, lastUsed: Date.now() })
  return { terminalPool }
}

function evictLRUState(state: AppState): Partial<AppState> {
  if (state.terminalPool.size === 0) return {}
  let oldestID = ''
  let oldestTime = Infinity
  for (const [id, entry] of state.terminalPool) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed
      oldestID = id
    }
  }
  if (!oldestID) return {}
  const terminalPool = new Map(state.terminalPool)
  terminalPool.delete(oldestID)
  void TerminalService.Close(oldestID).catch((error: unknown) => {
    logger.error('evictLRU: close terminal error', error)
  })
  return { terminalPool }
}

export function createPoolActions(set: StoreSet, get: StoreGet): PoolActions {
  return {
    registerTerminal: (id, terminal) => set((state) => registerTerminalState(state, get, id, terminal)),
    unregisterTerminal: (id) => set((state) => {
      const terminalPool = new Map(state.terminalPool)
      terminalPool.delete(id)
      return { terminalPool }
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

export function createStatusActions(set: StoreSet): StatusActions {
  return {
    setConnectionStatus: (id, status) => set((state) => ({ connectionStatus: { ...state.connectionStatus, [id]: status } })),
    setActivePane: (activePaneId) => set({ activePaneId }),
    setRecordingState: (id, recording) => set((state) => ({ recordingState: { ...state.recordingState, [id]: recording } })),
    setTunnelState: (id, tunnel) => set((state) => ({ tunnelState: { ...state.tunnelState, [id]: tunnel } })),
    setAppStatus: (appStatus) => set({ appStatus }),
    setTerminalTheme: (terminalTheme) => set({ terminalTheme }),
    setMaxPoolSize: (maxPoolSize) => set({ maxPoolSize }),
  }
}
