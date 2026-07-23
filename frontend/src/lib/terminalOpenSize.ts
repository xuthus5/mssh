import { useAppStore, type TerminalTab } from '@/store/appStore'

export type TerminalOpenSize = { cols: number; rows: number }

const DEFAULT_OPEN_SIZE: TerminalOpenSize = { cols: 80, rows: 24 }

/**
 * Prefer an explicit terminal's live size, then the active pane/surface terminal,
 * then the classic 80x24 default used by SSH clients.
 */
export function resolveOpenTerminalSize(preferredTerminalID?: string | null): TerminalOpenSize {
  const state = useAppStore.getState()
  const fromID = (terminalID: string | null | undefined): TerminalOpenSize | null => {
    if (!terminalID) return null
    const terminal = state.terminalPool.get(terminalID)?.terminal
    const cols = terminal?.cols ?? 0
    const rows = terminal?.rows ?? 0
    if (cols > 0 && rows > 0) return { cols, rows }
    return null
  }

  const preferred = fromID(preferredTerminalID)
  if (preferred) return preferred

  let activeID = state.activePaneId
  if (!activeID && state.activeSurface?.type === 'terminal') {
    const surfaceID = state.activeSurface.id
    const tab = state.tabs.find((item): item is TerminalTab => item.type === 'terminal' && item.id === surfaceID)
    activeID = tab?.terminalId ?? null
  }
  return fromID(activeID) ?? DEFAULT_OPEN_SIZE
}
