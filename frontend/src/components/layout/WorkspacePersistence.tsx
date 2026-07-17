import { useEffect, useRef } from 'react'
import { SettingService, TerminalService } from '@/lib/wails'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { createWorkspaceSnapshot, parseWorkspaceSnapshot, restoreWorkspaceSnapshot, WORKSPACE_LAYOUT_SETTING } from '@/store/workspacePersistence'

const SAVE_DELAY_MS = 300

export function WorkspacePersistence() {
  const { sessions, sessionsLoaded } = useSessionWorkspace()
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const workspaceTab = useAppStore((state) => state.workspaceTab)
  const overviewSection = useAppStore((state) => state.overviewSection)
  const initialized = useRef(false)

  useEffect(() => {
    if (!sessionsLoaded || initialized.current) return
    let cancelled = false
    const restore = async () => {
      try {
        const setting = await SettingService.Get(WORKSPACE_LAYOUT_SETTING)
        if (!setting || cancelled) return
        const snapshot = parseWorkspaceSnapshot(setting.value)
        const result = await restoreWorkspaceSnapshot(snapshot, new Set(sessions.map((session) => Number(session.id))), (sessionID) => TerminalService.Open(sessionID, 80, 24))
        if (cancelled) return
        const { failures, ...workspace } = result
        useAppStore.setState({ ...workspace, overviewReturnSurface: null, focusRequest: { id: '', terminalId: null, sequence: 0 } })
        if (failures > 0) toast(`${failures} 个工作区标签恢复失败`, 'warning')
      } catch (error) {
        logger.error('restore workspace failed', error)
      } finally {
        if (!cancelled) initialized.current = true
      }
    }
    void restore()
    return () => { cancelled = true }
  }, [sessions, sessionsLoaded])

  useEffect(() => {
    if (!initialized.current) return
    const snapshot = createWorkspaceSnapshot({ tabs, activeSurface, workspaceTab, overviewSection })
    const timer = window.setTimeout(() => {
      void SettingService.Set({ key: WORKSPACE_LAYOUT_SETTING, namespace: 'workspace', value: JSON.stringify(snapshot), value_type: 'object', version: 1 })
        .catch((error: unknown) => logger.error('save workspace failed', error))
    }, SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [activeSurface, overviewSection, tabs, workspaceTab])

  return null
}
