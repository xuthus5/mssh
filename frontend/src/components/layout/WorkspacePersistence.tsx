import { useEffect, useRef } from 'react'
import { SerialService, SettingService, TerminalService } from '@/lib/wails'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'
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
import { resolveOpenTerminalSize } from '@/lib/terminalOpenSize'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

const SAVE_DELAY_MS = 300

async function openRestoredTerminal(intent: OpenTerminalIntent): Promise<string> {
  const size = resolveOpenTerminalSize()
  return openTerminalWithPoolCapacity(() => {
    if (intent.connectionKind === 'local') {
      return TerminalService.OpenLocal(size.cols, size.rows)
    }
    if (intent.connectionKind === 'serial' && intent.serialPortId) {
      return TerminalService.OpenSerial(intent.serialPortId, size.cols, size.rows)
    }
    return TerminalService.Open(intent.sessionId, size.cols, size.rows)
  })
}

export function WorkspacePersistence() {
  const { sessions, sessionsLoaded } = useSessionWorkspace()
  const settingsHydrated = useTerminalBehaviorStore((state) => state.settingsHydrated)
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const workspaceTab = useAppStore((state) => state.workspaceTab)
  const overviewSection = useAppStore((state) => state.overviewSection)
  const restoreNonce = useAppStore((state) => state.workspaceRestoreNonce)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const saveReady = useRef(false)
  const generationRef = useRef(0)
  const completedNonceRef = useRef(-1)

  useEffect(() => {
    if (!sessionsLoaded || !settingsHydrated) return
    if (completedNonceRef.current === restoreNonce) return
    const generation = ++generationRef.current
    let cancelled = false
    const restore = async () => {
      const setError = useAppStore.getState().setWorkspaceRestoreError
      const setNotice = useAppStore.getState().setWorkspaceRestoreNotice
      try {
        if (!useTerminalBehaviorStore.getState().restoreTabsOnStartup) {
          if (generation !== generationRef.current || cancelled) return
          setError('')
          setNotice('')
          completedNonceRef.current = restoreNonce
          saveReady.current = true
          return
        }
        if (generation === generationRef.current && !cancelled) {
          setError('')
          setNotice('')
        }
        const setting = await SettingService.Get(WORKSPACE_LAYOUT_SETTING)
        if (cancelled || generation !== generationRef.current) return
        if (!setting) {
          completedNonceRef.current = restoreNonce
          saveReady.current = true
          return
        }
        const snapshot = parseWorkspaceSnapshot(setting.value)
        let serialPortIDs = new Set<number>()
        let serialListFailed = ''
        try {
          const ports = await SerialService.List()
          serialPortIDs = new Set((ports ?? []).map((port) => Number(port.id)).filter((id) => id > 0))
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          logger.error('restore workspace serial list failed', error)
          serialListFailed = message
        }
        if (cancelled || generation !== generationRef.current) return
        const sessionIDs = new Set(sessionsRef.current.map((session) => Number(session.id)))
        const result = await restoreWorkspaceSnapshot(
          snapshot,
          sessionIDs,
          openRestoredTerminal,
          serialPortIDs,
        )
        if (cancelled || generation !== generationRef.current) return
        const { failures, ...workspace } = result
        useAppStore.setState({
          ...workspace,
          overviewReturnSurface: null,
          focusRequest: { id: '', terminalId: null, sequence: 0 },
        })
        const notices: string[] = []
        if (serialListFailed) notices.push(t('加载串口配置失败: ${}', serialListFailed))
        if (failures > 0) notices.push(t('${} 个工作区标签恢复失败', failures))
        setNotice(notices.join(' · '))
        setError('')
        completedNonceRef.current = restoreNonce
        saveReady.current = true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('restore workspace failed', error)
        if (cancelled || generation !== generationRef.current) return
        useAppStore.getState().setWorkspaceRestoreError(message)
        useAppStore.getState().setWorkspaceRestoreNotice('')
        completedNonceRef.current = restoreNonce
        saveReady.current = true
      }
    }
    void restore()
    return () => { cancelled = true }
  }, [sessionsLoaded, settingsHydrated, restoreNonce])

  useEffect(() => {
    if (!saveReady.current) return
    const snapshot = createWorkspaceSnapshot({ tabs, activeSurface, workspaceTab, overviewSection })
    const timer = window.setTimeout(() => {
      void SettingService.Set({
        key: WORKSPACE_LAYOUT_SETTING,
        namespace: 'workspace',
        value: JSON.stringify(snapshot),
        value_type: 'object',
        version: 1,
      }).then(() => {
        useAppStore.getState().setWorkspaceSaveError('')
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('save workspace failed', error)
        useAppStore.getState().setWorkspaceSaveError(message)
      })
    }, SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [activeSurface, overviewSection, tabs, workspaceTab])

  return null
}

export function WorkspaceRestoreBanner() {
  const error = useAppStore((state) => state.workspaceRestoreError)
  const notice = useAppStore((state) => state.workspaceRestoreNotice)
  const saveError = useAppStore((state) => state.workspaceSaveError)
  const retry = useAppStore((state) => state.retryWorkspaceRestore)
  const dismissNotice = useAppStore((state) => state.setWorkspaceRestoreNotice)
  const dismissSaveError = useAppStore((state) => state.setWorkspaceSaveError)
  if (!error && !notice && !saveError) return null
  if (error) {
    return (
      <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('恢复工作区失败: ${}', error)}</span>
          <Button type="button" size="xs" variant="outline" onClick={() => retry()}>{t('重试')}</Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (saveError) {
    return (
      <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('保存工作区失败: ${}', saveError)}</span>
          <Button type="button" size="xs" variant="outline" onClick={() => dismissSaveError('')}>{t('关闭')}</Button>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert className="rounded-none border-x-0 border-t-0">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{notice}</span>
        <Button type="button" size="xs" variant="outline" onClick={() => dismissNotice('')}>{t('关闭')}</Button>
      </AlertDescription>
    </Alert>
  )
}
