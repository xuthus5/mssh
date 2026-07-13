import { create } from 'zustand'
import { Terminal } from '@xterm/xterm'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { fallbackAfterClose, initialNavigationState, isTerminalNotFoundError, persistNavigationCollapsed, persistSidebarWidth, surfaceForTab, type ActiveSurface, type WorkspaceID } from '@/store/tabNavigation'
export interface Tab {
  id: string
  title: string
  type: 'terminal' | 'playback'
  terminalId?: string
  sessionId?: number
}
export interface PooledTerminal {
  terminal: Terminal
  lastUsed: number
}
export interface TransferJob {
  id: string
  fileName: string
  direction: 'upload' | 'download'
  sessionId: number
  sessionName: string
  sourcePath: string
  targetPath: string
  totalBytes: number
  transferredBytes: number
  speed: number
  eta: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  error?: string
  startedAt: number
  completedAt?: number
}
export interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  cursorStyle: 'block' | 'underline' | 'bar'
  fontFamily: string
  fontSize: number
  ansiBlack: string
  ansiRed: string
  ansiGreen: string
  ansiYellow: string
  ansiBlue: string
  ansiMagenta: string
  ansiCyan: string
  ansiWhite: string
  ansiBrightBlack: string
  ansiBrightRed: string
  ansiBrightGreen: string
  ansiBrightYellow: string
  ansiBrightBlue: string
  ansiBrightMagenta: string
  ansiBrightCyan: string
  ansiBrightWhite: string
}
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

const DEFAULT_THEME: TerminalTheme = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#c9d1d9',
  cursorAccent: '#0d1117',
  selectionBackground: '#264f78',
  cursorStyle: 'bar',
  fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
  fontSize: 14,
  ansiBlack: '#000000',
  ansiRed: '#cd0000',
  ansiGreen: '#00cd00',
  ansiYellow: '#cdcd00',
  ansiBlue: '#0000ee',
  ansiMagenta: '#cd00cd',
  ansiCyan: '#00cdcd',
  ansiWhite: '#e5e5e5',
  ansiBrightBlack: '#7f7f7f',
  ansiBrightRed: '#ff0000',
  ansiBrightGreen: '#00ff00',
  ansiBrightYellow: '#ffff00',
  ansiBrightBlue: '#5c5cff',
  ansiBrightMagenta: '#ff00ff',
  ansiBrightCyan: '#00ffff',
  ansiBrightWhite: '#ffffff',
}
export interface AppState {
  tabs: Tab[]
  activeSurface: ActiveSurface | null
  workspaceTab: WorkspaceID
  navigationCollapsed: boolean
  sidebarWidth: number
  focusRequest: { id: string; sequence: number }
  terminalPool: Map<string, PooledTerminal>
  maxPoolSize: number
  connectionStatus: Record<string, ConnectionStatus>
  appStatus: string
  terminalTheme: TerminalTheme
  transfers: TransferJob[]
  transferCenterOpen: boolean
  activePaneId: string | null
  recordingState: Record<string, 'idle' | 'starting' | 'recording' | 'stopping' | 'error'>
  tunnelState: Record<string, 'running' | 'stopped'>
  addTransfer: (job: TransferJob) => void
  removeTransfer: (id: string) => void
  updateTransfer: (id: string, updates: Partial<Pick<TransferJob, 'transferredBytes' | 'speed' | 'totalBytes' | 'eta' | 'status' | 'error' | 'completedAt'>>) => void
  clearFinishedTransfers: () => void
  setTransferCenterOpen: (open: boolean) => void
  openTab: (tab: Tab) => void
  closeTab: (id: string) => Promise<void>
  removeTabLocal: (id: string) => void
  activateWorkspace: (id: WorkspaceID) => void
  activateTab: (id: string, focus?: boolean) => void
  toggleNavigation: () => void
  setSidebarWidth: (width: number) => void
  registerTerminal: (id: string, terminal: Terminal) => void
  unregisterTerminal: (id: string) => void
  updateLastUsed: (id: string) => void
  evictLRU: () => void
  setConnectionStatus: (id: string, status: ConnectionStatus) => void
  setActivePane: (id: string | null) => void
  setRecordingState: (id: string, state: AppState['recordingState'][string]) => void
  setTunnelState: (id: string, state: AppState['tunnelState'][string]) => void
  setAppStatus: (status: string) => void
  setTerminalTheme: (theme: TerminalTheme) => void
  setMaxPoolSize: (size: number) => void
}
const DEFAULT_MAX_POOL_SIZE = 32
const initialNavigation = initialNavigationState()

function workspaceTabForSurface(activeSurface: ActiveSurface | null, workspaceTab: WorkspaceID): WorkspaceID {
  return activeSurface?.type === 'workspace' ? activeSurface.id : workspaceTab
}

export const useAppStore = create<AppState>((set, get) => ({
  tabs: [],
  activeSurface: null,
  workspaceTab: 'sessions',
  ...initialNavigation,
  focusRequest: { id: '', sequence: 0 },
  terminalPool: new Map(),
  maxPoolSize: DEFAULT_MAX_POOL_SIZE,
  connectionStatus: {},
  appStatus: '就绪',
  terminalTheme: DEFAULT_THEME,
  transfers: [],
  transferCenterOpen: false,
  activePaneId: null,
  recordingState: {},
  tunnelState: {},

  addTransfer: (job) => set((s) => ({ transfers: [...s.transfers, job], transferCenterOpen: true })),
  removeTransfer: (id) => set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) })),
  updateTransfer: (id, updates) => set((s) => ({ transfers: s.transfers.map((t) => (t.id === id ? { ...t, ...updates } : t)) })),
  clearFinishedTransfers: () => set((s) => ({ transfers: s.transfers.filter((transfer) => transfer.status === 'queued' || transfer.status === 'running') })),
  setTransferCenterOpen: (transferCenterOpen) => set({ transferCenterOpen }),
  openTab: (tab) => set((s) => {
    const existing = s.tabs.find((t) => t.id === tab.id)
    if (existing) {
      return { activeSurface: surfaceForTab(existing) }
    }
    return { tabs: [...s.tabs, tab], activeSurface: surfaceForTab(tab) }
  }),
  closeTab: async (id) => {
    const state = get()
    const tab = state.tabs.find((t) => t.id === id)
    if (tab?.type === 'terminal' && tab.terminalId) {
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
  },
  removeTabLocal: (id) => set((s) => {
    const tab = s.tabs.find((item) => item.id === id)
    const terminalId = tab?.terminalId
    const activeSurface = s.activeSurface?.id === id ? fallbackAfterClose(s.tabs, id) : s.activeSurface
    const workspaceTab = workspaceTabForSurface(activeSurface, s.workspaceTab)
    if (terminalId) {
      const pool = new Map(s.terminalPool)
      pool.delete(terminalId)
      const connectionStatus = { ...s.connectionStatus }
      delete connectionStatus[terminalId]
      const recordingState = { ...s.recordingState }
      delete recordingState[terminalId]
      const tabs = s.tabs.filter((item) => item.id !== id)
      return {
        tabs,
        terminalPool: pool,
        connectionStatus,
        recordingState,
        activePaneId: s.activePaneId === terminalId ? null : s.activePaneId,
        activeSurface,
        workspaceTab,
      }
    }
    const tabs = s.tabs.filter((item) => item.id !== id)
    return { tabs, activeSurface, workspaceTab }
  }),
  activateWorkspace: (id) => set({
    activeSurface: { type: 'workspace', id },
    workspaceTab: id,
  }),
  activateTab: (id, focus = false) => set((s) => {
    const tab = s.tabs.find((item) => item.id === id)
    if (!tab) return {}
    return {
      activeSurface: surfaceForTab(tab),
      focusRequest: focus ? { id, sequence: s.focusRequest.sequence + 1 } : s.focusRequest,
    }
  }),
  toggleNavigation: () => set((s) => {
    const navigationCollapsed = !s.navigationCollapsed
    persistNavigationCollapsed(navigationCollapsed)
    return { navigationCollapsed }
  }),
  setSidebarWidth: (sidebarWidth) => {
    set({ sidebarWidth: persistSidebarWidth(sidebarWidth) })
  },
  registerTerminal: (id, terminal) => set((s) => {
    const pool = new Map(s.terminalPool)
    if (pool.size >= s.maxPoolSize) {
      get().evictLRU()
      const current = new Map(get().terminalPool)
      current.set(id, { terminal, lastUsed: Date.now() })
      return { terminalPool: current }
    }
    pool.set(id, { terminal, lastUsed: Date.now() })
    return { terminalPool: pool }
  }),
  unregisterTerminal: (id) => set((s) => {
    const pool = new Map(s.terminalPool)
    pool.delete(id)
    return { terminalPool: pool }
  }),
  updateLastUsed: (id) => set((s) => {
    const entry = s.terminalPool.get(id)
    if (!entry) return {}
    const pool = new Map(s.terminalPool)
    pool.set(id, { ...entry, lastUsed: Date.now() })
    return { terminalPool: pool }
  }),
  evictLRU: () => set((s) => {
    if (s.terminalPool.size === 0) return {}
    let oldestId = ''
    let oldestTime = Infinity
    for (const [id, entry] of s.terminalPool) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed
        oldestId = id
      }
    }
    if (!oldestId) return {}
    const pool = new Map(s.terminalPool)
    pool.delete(oldestId)
    TerminalService.Close(oldestId).catch((err: unknown) => {
      logger.error('evictLRU: close terminal error', err)
    })
    return { terminalPool: pool }
  }),
  setConnectionStatus: (id, status) => set((s) => ({
    connectionStatus: { ...s.connectionStatus, [id]: status },
  })),
  setActivePane: (id) => set({ activePaneId: id }),
  setRecordingState: (id, state) => set((s) => ({
    recordingState: { ...s.recordingState, [id]: state },
  })),
  setTunnelState: (id, state) => set((s) => ({
    tunnelState: { ...s.tunnelState, [id]: state },
  })),
  setAppStatus: (status) => set({ appStatus: status }),
  setTerminalTheme: (theme) => set({ terminalTheme: theme }),
  setMaxPoolSize: (maxPoolSize) => set({ maxPoolSize }),
}))
