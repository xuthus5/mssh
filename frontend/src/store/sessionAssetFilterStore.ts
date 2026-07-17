import { create } from 'zustand'
import { emptySessionAssetFilters, type SessionAssetFilters } from '@/lib/sessionAssetSearch'

interface SessionAssetFilterState {
  filters: SessionAssetFilters
  setFilters: (updates: Partial<SessionAssetFilters>) => void
  resetFilters: () => void
}

export const useSessionAssetFilterStore = create<SessionAssetFilterState>((set) => ({
  filters: { ...emptySessionAssetFilters },
  setFilters: (updates) => set((state) => ({ filters: { ...state.filters, ...updates } })),
  resetFilters: () => set({ filters: { ...emptySessionAssetFilters } }),
}))
