import { create } from 'zustand'

export type TerminalRightClickAction = 'menu' | 'paste'

export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 10000
export const MIN_TERMINAL_SCROLLBACK_LINES = 1000
export const MAX_TERMINAL_SCROLLBACK_LINES = 100000

export interface TerminalBehaviorSettings {
  rightClickAction: TerminalRightClickAction
  copyOnSelect: boolean
  /** Max retained scrollback lines per terminal instance (xterm buffer). */
  scrollbackLines: number
}

interface TerminalBehaviorState extends TerminalBehaviorSettings {
  setSettings: (settings: TerminalBehaviorSettings) => void
}

export const DEFAULT_TERMINAL_BEHAVIOR: TerminalBehaviorSettings = {
  rightClickAction: 'menu',
  copyOnSelect: false,
  scrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
}

export function normalizeTerminalRightClickAction(value: unknown): TerminalRightClickAction {
  return value === 'paste' ? 'paste' : 'menu'
}

export function normalizeCopyOnSelect(value: unknown): boolean {
  return value === true
}

/** Clamp scrollback to a safe bounded range; invalid values fall back to default. */
export function normalizeScrollbackLines(value: unknown): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numeric)) return DEFAULT_TERMINAL_SCROLLBACK_LINES
  const rounded = Math.round(numeric)
  if (rounded < MIN_TERMINAL_SCROLLBACK_LINES) return MIN_TERMINAL_SCROLLBACK_LINES
  if (rounded > MAX_TERMINAL_SCROLLBACK_LINES) return MAX_TERMINAL_SCROLLBACK_LINES
  return rounded
}

export const useTerminalBehaviorStore = create<TerminalBehaviorState>((set) => ({
  ...DEFAULT_TERMINAL_BEHAVIOR,
  setSettings: (settings) => set({
    rightClickAction: normalizeTerminalRightClickAction(settings.rightClickAction),
    copyOnSelect: normalizeCopyOnSelect(settings.copyOnSelect),
    scrollbackLines: normalizeScrollbackLines(settings.scrollbackLines),
  }),
}))
