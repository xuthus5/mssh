import { create } from 'zustand'
import {
  defaultShortcutBindings,
  normalizeShortcutBindings,
  type ShortcutActionId,
  type ShortcutBindings,
  type ShortcutChord,
} from '@/lib/shortcuts'

interface ShortcutState {
  bindings: ShortcutBindings
  settingsHydrated: boolean
  setBindings: (bindings: ShortcutBindings) => void
  setBinding: (actionId: ShortcutActionId, chord: ShortcutChord | null) => void
  resetDefaults: () => void
  markSettingsHydrated: () => void
}

export const useShortcutStore = create<ShortcutState>((set) => ({
  bindings: defaultShortcutBindings(),
  settingsHydrated: false,
  setBindings: (bindings) => set({ bindings: normalizeShortcutBindings(bindings) }),
  setBinding: (actionId, chord) => set((state) => ({
    bindings: { ...state.bindings, [actionId]: chord },
  })),
  resetDefaults: () => set({ bindings: defaultShortcutBindings() }),
  markSettingsHydrated: () => set({ settingsHydrated: true }),
}))
