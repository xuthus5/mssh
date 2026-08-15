import { SettingService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { settingEntry } from '@/hooks/generalSettingsModel'

/** Persist the terminal close preference so future closes skip confirmation. */
export async function persistTerminalClosePreference(autoClose: boolean): Promise<void> {
  const current = useTerminalBehaviorStore.getState()
  useTerminalBehaviorStore.getState().setSettings({
    rightClickAction: current.rightClickAction,
    copyOnSelect: current.copyOnSelect,
    scrollbackLines: current.scrollbackLines,
    autoReconnect: current.autoReconnect,
    restoreTabsOnStartup: current.restoreTabsOnStartup,
    renderer: current.renderer,
    historyPredict: current.historyPredict,
    autoCloseTerminalOnExit: autoClose,
  })
  try {
    await SettingService.Set(settingEntry('terminal.auto_close_terminal_on_exit', autoClose))
  } catch (error) {
    logger.error('persist terminal close preference failed', error)
  }
}
