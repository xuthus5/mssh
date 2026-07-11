import { create } from 'zustand'
import { Terminal } from '@xterm/xterm'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'

export interface Tab {
  id: string
  title: string
  type: 'terminal' | 'playback' | 'settings'
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
  totalBytes: number
  transferredBytes: number
  speed: number
  startedAt: number
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
  activeTabId: string | null
  terminalPool: Map<string, PooledTerminal>
  maxPoolSize: number
  connectionStatus: Record<string, ConnectionStatus>
  appStatus: string
  terminalTheme: TerminalTheme
  transfers: TransferJob[]
  addTransfer: (job: TransferJob) => void
  removeTransfer: (id: string) => void
  updateTransfer: (id: string, updates: Partial<Pick<TransferJob, 'transferredBytes' | 'speed' | 'totalBytes'>>) => void
  openTab: (tab: Tab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  registerTerminal: (id: string, terminal: Terminal) => void
  unregisterTerminal: (id: string) => void
  updateLastUsed: (id: string) => void
  evictLRU: () => void
  setConnectionStatus: (id: string, status: ConnectionStatus) => void
  setAppStatus: (status: string) => void
  setTerminalTheme: (theme: TerminalTheme) => void
}

const DEFAULT_MAX_POOL_SIZE = 32

export const useAppStore = create<AppState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  terminalPool: new Map(),
  maxPoolSize: DEFAULT_MAX_POOL_SIZE,
  connectionStatus: {},
  appStatus: '就绪',
  terminalTheme: DEFAULT_THEME,
  transfers: [],

  addTransfer: (job) => set((s) => ({ transfers: [...s.transfers, job] })),
  removeTransfer: (id) => set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) })),
  updateTransfer: (id, updates) => set((s) => ({
    transfers: s.transfers.map((t) => (t.id === id ? { ...t, ...updates } : t)),
  })),

  openTab: (tab) => set((s) => {
    const existing = s.tabs.find((t) => t.id === tab.id)
    if (existing) {
      return { activeTabId: tab.id }
    }
    return { tabs: [...s.tabs, tab], activeTabId: tab.id }
  }),
  closeTab: (id) => {
    const state = get()
    const tab = state.tabs.find((t) => t.id === id)
    if (tab?.terminalId) {
      TerminalService.Close(tab.terminalId).catch((err: unknown) => {
        logger.error('closeTab: close terminal error', err)
      })
      state.unregisterTerminal(tab.terminalId)
    }
    set((s) => {
      const newTabs = s.tabs.filter((t) => t.id !== id)
      let newActive = s.activeTabId
      if (s.activeTabId === id) {
        newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null
      }
      return { tabs: newTabs, activeTabId: newActive }
    })
  },
  setActiveTab: (id) => set({ activeTabId: id }),

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

  setAppStatus: (status) => set({ appStatus: status }),

  setTerminalTheme: (theme) => set({ terminalTheme: theme }),
}))
