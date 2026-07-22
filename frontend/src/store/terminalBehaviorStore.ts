import { create } from 'zustand'

export type TerminalRightClickAction = 'menu' | 'paste'
export type TerminalRenderer = 'dom' | 'canvas' | 'webgl'

export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 10000
export const MIN_TERMINAL_SCROLLBACK_LINES = 1000
export const MAX_TERMINAL_SCROLLBACK_LINES = 100000
export const DEFAULT_TERMINAL_RENDERER: TerminalRenderer = 'dom'

export interface TerminalBehaviorSettings {
  rightClickAction: TerminalRightClickAction
  copyOnSelect: boolean
  /** Max retained scrollback lines per terminal instance (xterm buffer). */
  scrollbackLines: number
  /** Automatically reconnect after unexpected SSH disconnects. */
  autoReconnect: boolean
  /** Restore open terminal tabs after application restart. */
  restoreTabsOnStartup: boolean
  /** xterm renderer backend. */
  renderer: TerminalRenderer
}

interface TerminalBehaviorState extends TerminalBehaviorSettings {
  settingsHydrated: boolean
  setSettings: (settings: TerminalBehaviorSettings) => void
  markSettingsHydrated: () => void
}

export const DEFAULT_TERMINAL_BEHAVIOR: TerminalBehaviorSettings = {
  rightClickAction: 'menu',
  copyOnSelect: false,
  scrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  autoReconnect: false,
  restoreTabsOnStartup: true,
  renderer: DEFAULT_TERMINAL_RENDERER,
}

export function normalizeTerminalRightClickAction(value: unknown): TerminalRightClickAction {
  return value === 'paste' ? 'paste' : 'menu'
}

export function normalizeCopyOnSelect(value: unknown): boolean {
  return value === true
}

/** Clamp scrollback to a safe bounded range; invalid values fall back to default. */
export function normalizeScrollbackLines(value: unknown): number {
  if (value === null || value === undefined) return DEFAULT_TERMINAL_SCROLLBACK_LINES
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_TERMINAL_SCROLLBACK_LINES
  if (parsed < MIN_TERMINAL_SCROLLBACK_LINES) return MIN_TERMINAL_SCROLLBACK_LINES
  if (parsed > MAX_TERMINAL_SCROLLBACK_LINES) return MAX_TERMINAL_SCROLLBACK_LINES
  return Math.floor(parsed)
}

export function normalizeAutoReconnect(value: unknown): boolean {
  return value === true
}

export function normalizeRestoreTabsOnStartup(value: unknown): boolean {
  return value !== false
}

export function normalizeTerminalRenderer(value: unknown): TerminalRenderer {
  if (value === 'canvas' || value === 'webgl' || value === 'dom') return value
  return DEFAULT_TERMINAL_RENDERER
}

export const useTerminalBehaviorStore = create<TerminalBehaviorState>((set) => ({
  ...DEFAULT_TERMINAL_BEHAVIOR,
  settingsHydrated: false,
  setSettings: (settings) => set({
    rightClickAction: normalizeTerminalRightClickAction(settings.rightClickAction),
    copyOnSelect: normalizeCopyOnSelect(settings.copyOnSelect),
    scrollbackLines: normalizeScrollbackLines(settings.scrollbackLines),
    autoReconnect: normalizeAutoReconnect(settings.autoReconnect),
    restoreTabsOnStartup: normalizeRestoreTabsOnStartup(settings.restoreTabsOnStartup),
    renderer: normalizeTerminalRenderer(settings.renderer),
  }),
  markSettingsHydrated: () => set({ settingsHydrated: true }),
}))
