import { TerminalService } from '@/lib/wails'
import { createTerminalTab } from '@/lib/terminalTabs'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { useAppStore } from '@/store/appStore'
import { t } from '@/i18n'

/** Open a local interactive shell terminal tab. */
export async function openLocalTerminal(title = t('本地终端')): Promise<string> {
  const terminalId = await openTerminalWithPoolCapacity(
    () => TerminalService.OpenLocal(80, 24),
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
