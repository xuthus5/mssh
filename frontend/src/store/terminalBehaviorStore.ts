import { create } from 'zustand'

export type TerminalRightClickAction = 'menu' | 'paste'

export interface TerminalBehaviorSettings {
  rightClickAction: TerminalRightClickAction
  copyOnSelect: boolean
}

interface TerminalBehaviorState extends TerminalBehaviorSettings {
  setSettings: (settings: TerminalBehaviorSettings) => void
}

export const DEFAULT_TERMINAL_BEHAVIOR: TerminalBehaviorSettings = {
  rightClickAction: 'menu',
  copyOnSelect: false,
}

export function normalizeTerminalRightClickAction(value: unknown): TerminalRightClickAction {
  return value === 'paste' ? 'paste' : 'menu'
}

export function normalizeCopyOnSelect(value: unknown): boolean {
  return value === true
}

export const useTerminalBehaviorStore = create<TerminalBehaviorState>((set) => ({
  ...DEFAULT_TERMINAL_BEHAVIOR,
  setSettings: (settings) => set(settings),
}))
