import { MacroService } from '@/lib/wails'
import { recordCommand } from '@/lib/commandHistory'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { useAppStore, type Tab } from '@/store/appStore'

export interface ExecuteMacroOptions {
  /** When true, only execute if the active surface is a terminal tab (sidebar). */
  requireTerminalSurface?: boolean
}

function isTerminalTab(tab: Tab | undefined): tab is Extract<Tab, { type: 'terminal' }> {
  return Boolean(tab && tab.type === 'terminal')
}

function resolveActiveTerminalTab(requireTerminalSurface: boolean) {
  const state = useAppStore.getState()
  const surface = state.activeSurface
  if (surface?.type === 'terminal') {
    const active = state.tabs.find((item) => item.id === surface.id)
    return isTerminalTab(active) ? active : undefined
  }
  if (requireTerminalSurface) return undefined
  return state.tabs.find((item): item is Extract<Tab, { type: 'terminal' }> => item.type === 'terminal')
}

function resolveTargetTerminalID(tab: Extract<Tab, { type: 'terminal' }>) {
  const state = useAppStore.getState()
  const paneID = state.activePaneId
  if (!paneID) return tab.terminalId
  if (paneID === tab.terminalId) return paneID
  if ((tab.splitPaneIDs ?? []).includes(paneID)) return paneID
  return tab.terminalId
}

/** Send a macro/command to the active terminal pane with commercial failure feedback. */
export async function executeMacroOnActiveTerminal(
  command: string,
  options: ExecuteMacroOptions = {},
): Promise<void> {
  const requireTerminalSurface = options.requireTerminalSurface === true
  const tab = resolveActiveTerminalTab(requireTerminalSurface)
  if (!tab) {
    toast(t('请先连接终端后再执行宏'), 'info')
    return
  }
  const terminalID = resolveTargetTerminalID(tab)
  const status = useAppStore.getState().connectionStatus[terminalID]
  if (status !== 'connected') {
    toast(t('当前终端未连接，无法执行宏'), 'warning')
    return
  }
  try {
    await MacroService.Execute(terminalID, command)
    recordCommand(tab.sessionId, command)
    toast(t('宏已发送到活动终端'), 'success')
  } catch (error: unknown) {
    toast(t('执行宏失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
  }
}
