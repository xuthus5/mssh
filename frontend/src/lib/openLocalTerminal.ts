import { TerminalService } from '@/lib/wails'
import { createTerminalTab } from '@/lib/terminalTabs'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { useAppStore, type TerminalTab } from '@/store/appStore'
import { t } from '@/i18n'

function resolveOpenSize(): { cols: number; rows: number } {
  const state = useAppStore.getState()
  let activeID = state.activePaneId
  if (!activeID && state.activeSurface?.type === 'terminal') {
    const surfaceID = state.activeSurface.id
    const tab = state.tabs.find((item): item is TerminalTab => item.type === 'terminal' && item.id === surfaceID)
    activeID = tab?.terminalId ?? null
  }
  if (activeID) {
    const terminal = state.terminalPool.get(activeID)?.terminal
    const cols = terminal?.cols ?? 0
    const rows = terminal?.rows ?? 0
    if (cols > 0 && rows > 0) return { cols, rows }
  }
  return { cols: 80, rows: 24 }
}

/** Open a local interactive shell terminal tab. */
export async function openLocalTerminal(title = t('本地终端')): Promise<string> {
  const size = resolveOpenSize()
  const terminalId = await openTerminalWithPoolCapacity(
    () => TerminalService.OpenLocal(size.cols, size.rows),
  )
  const store = useAppStore.getState()
  const tab = createTerminalTab({
    sessionID: 0,
    sessionName: title,
    terminalID: terminalId,
    tabs: store.tabs,
    connectionKind: 'local',
  })
  store.setConnectionStatus(terminalId, 'connected')
  store.openTab(tab)
  return terminalId
}
