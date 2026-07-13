import type { Tab } from '@/store/appStore'

export type WorkspaceID = 'sessions' | 'macros'

export type ActiveSurface =
  | { type: 'workspace'; id: WorkspaceID }
  | { type: 'terminal'; id: string }
  | { type: 'playback'; id: string }

const DEFAULT_SIDEBAR_WIDTH = 280
const SIDEBAR_WIDTH_STORAGE_KEY = 'mssh:sidebar-width'
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'mssh:sidebar-collapsed'

export function surfaceForTab(tab: Tab): ActiveSurface {
  return { type: tab.type, id: tab.id }
}

export function fallbackAfterClose(tabs: Tab[], closingID: string): ActiveSurface {
  const index = tabs.findIndex((tab) => tab.id === closingID)
  const remaining = tabs.filter((tab) => tab.id !== closingID)
  const next = remaining[index] ?? remaining[index - 1]
  return next ? surfaceForTab(next) : { type: 'workspace', id: 'sessions' }
}

export function initialNavigationState() {
  return {
    navigationCollapsed: localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true',
    sidebarWidth: Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)) || DEFAULT_SIDEBAR_WIDTH,
  }
}

export function persistNavigationCollapsed(navigationCollapsed: boolean) {
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(navigationCollapsed))
}

export function persistSidebarWidth(sidebarWidth: number) {
  localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
}

export function isTerminalNotFoundError(error: unknown): boolean {
  return error instanceof Error && /^terminal .+ not found$/.test(error.message)
}
