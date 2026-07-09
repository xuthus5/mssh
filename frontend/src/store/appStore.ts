import { create } from 'zustand'
import { Terminal } from '@xterm/xterm'

export interface Tab {
  id: string
  title: string
  type: 'terminal' | 'playback' | 'settings'
  terminalId?: string
}

export interface PooledTerminal {
  terminal: Terminal
  lastUsed: number
}

export interface AppState {
  tabs: Tab[]
  activeTabId: string | null
  terminalPool: Map<string, PooledTerminal>
  maxPoolSize: number
  openTab: (tab: Tab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  registerTerminal: (id: string, terminal: Terminal) => void
  unregisterTerminal: (id: string) => void
  updateLastUsed: (id: string) => void
  evictLRU: () => void
}

const DEFAULT_MAX_POOL_SIZE = 10

export const useAppStore = create<AppState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  terminalPool: new Map(),
  maxPoolSize: DEFAULT_MAX_POOL_SIZE,

  openTab: (tab) => set((s) => {
    const existing = s.tabs.find((t) => t.id === tab.id)
    if (existing) {
      return { activeTabId: tab.id }
    }
    return { tabs: [...s.tabs, tab], activeTabId: tab.id }
  }),
  closeTab: (id) => set((s) => {
    const newTabs = s.tabs.filter((t) => t.id !== id)
    let newActive = s.activeTabId
    if (s.activeTabId === id) {
      newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null
    }
    return { tabs: newTabs, activeTabId: newActive }
  }),
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
    return { terminalPool: pool }
  }),
}))
