import { useEffect, useRef } from 'react'
import { SerialService, SettingService, TerminalService } from '@/lib/wails'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import {
  createWorkspaceSnapshot,
  parseWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
  WORKSPACE_LAYOUT_SETTING,
  type OpenTerminalIntent,
} from '@/store/workspacePersistence'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { t } from '@/i18n'

const SAVE_DELAY_MS = 300

async function openRestoredTerminal(intent: OpenTerminalIntent): Promise<string> {
  return openTerminalWithPoolCapacity(() => {
    if (intent.connectionKind === 'local') {
      return TerminalService.OpenLocal(80, 24)
    }
    if (intent.connectionKind === 'serial' && intent.serialPortId) {
      return TerminalService.OpenSerial(intent.serialPortId, 80, 24)
    }
    return TerminalService.Open(intent.sessionId, 80, 24)
  })
}

export function WorkspacePersistence() {
  const { sessions, sessionsLoaded } = useSessionWorkspace()
  const settingsHydrated = useTerminalBehaviorStore((state) => state.settingsHydrated)
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const workspaceTab = useAppStore((state) => state.workspaceTab)
  const overviewSection = useAppStore((state) => state.overviewSection)
  const initialized = useRef(false)

  useEffect(() => {
    if (!sessionsLoaded || !settingsHydrated || initialized.current) return
    let cancelled = false
    const restore = async () => {
      try {
        if (!useTerminalBehaviorStore.getState().restoreTabsOnStartup) {
          initialized.current = true
          return
        }
        const setting = await SettingService.Get(WORKSPACE_LAYOUT_SETTING)
        if (!setting || cancelled) return
        const snapshot = parseWorkspaceSnapshot(setting.value)
        let serialPortIDs = new Set<number>()
        try {
          const ports = await SerialService.List()
          serialPortIDs = new Set((ports ?? []).map((port) => Number(port.id)).filter((id) => id > 0))
        } catch (error: unknown) {
          logger.error('restore workspace serial list failed', error)
        }
        const result = await restoreWorkspaceSnapshot(
          snapshot,
          new Set(sessions.map((session) => Number(session.id))),
          openRestoredTerminal,
          serialPortIDs,
        )
        if (cancelled) return
        const { failures, ...workspace } = result
        useAppStore.setState({
          ...workspace,
          overviewReturnSurface: null,
          focusRequest: { id: '', terminalId: null, sequence: 0 },
        })
        if (failures > 0) toast(t('${} 个工作区标签恢复失败', failures), 'warning')
      } catch (error) {
        logger.error('restore workspace failed', error)
      } finally {
        if (!cancelled) initialized.current = true
      }
    }
    void restore()
    return () => { cancelled = true }
  }, [sessions, sessionsLoaded, settingsHydrated])

  useEffect(() => {
    if (!initialized.current) return
    const snapshot = createWorkspaceSnapshot({ tabs, activeSurface, workspaceTab, overviewSection })
    const timer = window.setTimeout(() => {
      void SettingService.Set({
        key: WORKSPACE_LAYOUT_SETTING,
        namespace: 'workspace',
        value: JSON.stringify(snapshot),
        value_type: 'object',
        version: 1,
      }).catch((error: unknown) => logger.error('save workspace failed', error))
    }, SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [activeSurface, overviewSection, tabs, workspaceTab])

  return null
}
