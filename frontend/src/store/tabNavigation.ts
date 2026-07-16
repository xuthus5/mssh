import type { Tab } from '@/store/appStore'

export type WorkspaceID = 'overview' | 'sessions' | 'macros'
export type OverviewSection = 'sessions' | 'keys' | 'tunnels'

export type ActiveSurface =
  | { type: 'workspace'; id: WorkspaceID }
  | { type: 'terminal'; id: string }
  | { type: 'playback'; id: string }

export const WORKSPACE_PANEL_ID = 'workspace-panel'

export function workspaceTabID(workspaceID: WorkspaceID): string {
  return `workspace-tab-${workspaceID}`
}

export function dynamicTabID(tabID: string): string {
  return `dynamic-tab-${tabID}`
}

export function dynamicPanelID(tabID: string): string {
  return `dynamic-panel-${tabID}`
}

const DEFAULT_SIDEBAR_WIDTH = 280
const MIN_SIDEBAR_WIDTH = 220
const MAX_SIDEBAR_WIDTH = 480
const SIDEBAR_WIDTH_STORAGE_KEY = 'mssh:sidebar-width'
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'mssh:sidebar-collapsed'

export function clampSidebarWidth(sidebarWidth: number): number {
  if (Number.isNaN(sidebarWidth)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(Math.max(sidebarWidth, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH)
}

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
  const persistedWidth = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
  return {
    navigationCollapsed: localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true',
    sidebarWidth: persistedWidth === null
      ? DEFAULT_SIDEBAR_WIDTH
      : clampSidebarWidth(Number(persistedWidth)),
  }
}

export function persistNavigationCollapsed(navigationCollapsed: boolean) {
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(navigationCollapsed))
}

export function persistSidebarWidth(sidebarWidth: number): number {
  const clampedWidth = clampSidebarWidth(sidebarWidth)
  localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampedWidth))
  return clampedWidth
}

export function isTerminalNotFoundError(error: unknown): boolean {
  return error instanceof Error && /^terminal .+ not found$/.test(error.message)
}
