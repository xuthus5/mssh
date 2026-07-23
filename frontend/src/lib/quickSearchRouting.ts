import type { ActiveSurface } from '@/store/tabNavigation'

/** Decide which search surface Mod+F / quick-search should open. */
export function resolveQuickSearchTarget(activeSurface: ActiveSurface | null | undefined): 'terminal-search' | 'session-search' {
  return activeSurface?.type === 'terminal' ? 'terminal-search' : 'session-search'
}
