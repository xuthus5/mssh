import { create } from 'zustand'

export interface Tab {
  id: string
  title: string
  type: 'terminal' | 'playback' | 'settings'
  terminalId?: string
}

export interface AppState {
  tabs: Tab[]
  activeTabId: string | null
  openTab: (tab: Tab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  tabs: [],
  activeTabId: null,
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
}))
