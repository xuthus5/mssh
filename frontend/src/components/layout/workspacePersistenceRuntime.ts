import { useEffect, useRef } from 'react'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { resolveOpenTerminalSize } from '@/lib/terminalOpenSize'
import { logger } from '@/lib/logger'
import { SerialService, SettingService, TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import {
  createWorkspaceSnapshot,
  parseWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
  WORKSPACE_LAYOUT_SETTING,
  type OpenTerminalIntent,
} from '@/store/workspacePersistence'
import { t } from '@/i18n'

const SAVE_DELAY_MS = 300

interface WorkspaceSaveQueue {
  enqueue: (value: string) => void
  dispose: () => void
}

async function persistWorkspaceSnapshot(value: string) {
  await SettingService.Set({
    key: WORKSPACE_LAYOUT_SETTING,
    namespace: 'workspace',
    value,
    value_type: 'object',
    version: 1,
  })
}

function currentWorkspaceSnapshotValue() {
  const { tabs, activeSurface, workspaceTab, overviewSection } = useAppStore.getState()
  return JSON.stringify(createWorkspaceSnapshot({ tabs, activeSurface, workspaceTab, overviewSection }))
}

function createWorkspaceSaveQueue(): WorkspaceSaveQueue {
  let active = true
  let running = false
  let revision = 0
  let pending: { revision: number; value: string } | null = null
  const drain = async () => {
    if (running) return
    running = true
    while (active && pending) {
      const current = pending
      pending = null
      try {
        await persistWorkspaceSnapshot(current.value)
        if (active && current.revision === revision) useAppStore.getState().setWorkspaceSaveError('')
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('save workspace failed', error)
        if (active && current.revision === revision) useAppStore.getState().setWorkspaceSaveError(message)
      }
    }
    running = false
  }
  return {
    enqueue: (value) => { pending = { revision: ++revision, value }; void drain() },
    dispose: () => { active = false; pending = null; revision++ },
  }
}

async function openRestoredTerminal(intent: OpenTerminalIntent): Promise<string> {
  const size = resolveOpenTerminalSize()
  return openTerminalWithPoolCapacity(() => {
    if (intent.connectionKind === 'local') return TerminalService.OpenLocal(size.cols, size.rows)
    if (intent.connectionKind === 'serial' && intent.serialPortId) {
      return TerminalService.OpenSerial(intent.serialPortId, size.cols, size.rows)
    }
    return TerminalService.Open(intent.sessionId, size.cols, size.rows)
  })
}

function usePersistenceRuntime(sessions: Array<{ id: string }>) {
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const saveReady = useRef(false)
  const observedSnapshot = useRef<string | null>(null)
  const generationRef = useRef(0)
  const completedNonceRef = useRef(-1)
  const saveQueueRef = useRef<WorkspaceSaveQueue | null>(null)
  useEffect(() => {
    saveQueueRef.current = createWorkspaceSaveQueue()
    return () => { saveQueueRef.current?.dispose(); saveQueueRef.current = null }
  }, [])
  return { sessionsRef, saveReady, observedSnapshot, generationRef, completedNonceRef, saveQueueRef }
}

type PersistenceRuntime = ReturnType<typeof usePersistenceRuntime>

function completeRestore(runtime: PersistenceRuntime, restoreNonce: number) {
  runtime.completedNonceRef.current = restoreNonce
  runtime.observedSnapshot.current = currentWorkspaceSnapshotValue()
  runtime.saveReady.current = true
}

async function loadSerialPortIDs() {
  try {
    const ports = await SerialService.List()
    const ids = new Set((ports ?? []).map((port) => Number(port.id)).filter((id) => id > 0))
    return { ids, error: '' }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('restore workspace serial list failed', error)
    return { ids: new Set<number>(), error: message }
  }
}

async function restoreSavedWorkspace(options: {
  value: string
  runtime: PersistenceRuntime
  restoreNonce: number
  isCurrent: () => boolean
}) {
  const snapshot = parseWorkspaceSnapshot(options.value)
  const repairStoredSnapshot = workspaceSnapshotNeedsRepair(options.value, snapshot)
  const serial = await loadSerialPortIDs()
  if (!options.isCurrent()) return
  const sessionIDs = new Set(options.runtime.sessionsRef.current.map((session) => Number(session.id)))
  const result = await restoreWorkspaceSnapshot(snapshot, sessionIDs, openRestoredTerminal, serial.ids)
  if (!options.isCurrent()) return
  const { failures, ...workspace } = result
  useAppStore.setState({
    ...workspace,
    overviewReturnSurface: null,
    focusRequest: { id: '', terminalId: null, sequence: 0 },
  })
  const notices: string[] = []
  if (serial.error) notices.push(t('加载串口配置失败: ${}', serial.error))
  if (failures > 0) notices.push(t('${} 个工作区标签恢复失败', failures))
  useAppStore.getState().setWorkspaceRestoreNotice(notices.join(' · '))
  useAppStore.getState().setWorkspaceRestoreError('')
  if (repairStoredSnapshot) await persistRepairedWorkspace()
  completeRestore(options.runtime, options.restoreNonce)
}

function workspaceSnapshotNeedsRepair(raw: string, snapshot: ReturnType<typeof parseWorkspaceSnapshot>): boolean {
  try {
    const original = JSON.parse(raw) as { version?: unknown }
    return original?.version === snapshot.version && JSON.stringify(original) !== JSON.stringify(snapshot)
  } catch {
    return false
  }
}

async function persistRepairedWorkspace() {
  try {
    await persistWorkspaceSnapshot(currentWorkspaceSnapshotValue())
    useAppStore.getState().setWorkspaceSaveError('')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('save repaired workspace failed', error)
    useAppStore.getState().setWorkspaceSaveError(message)
  }
}

async function runWorkspaceRestore(options: {
  runtime: PersistenceRuntime
  restoreNonce: number
  isCurrent: () => boolean
}) {
  const setError = useAppStore.getState().setWorkspaceRestoreError
  const setNotice = useAppStore.getState().setWorkspaceRestoreNotice
  try {
    if (!useTerminalBehaviorStore.getState().restoreTabsOnStartup) {
      if (!options.isCurrent()) return
      setError('')
      setNotice('')
      completeRestore(options.runtime, options.restoreNonce)
      return
    }
    if (options.isCurrent()) { setError(''); setNotice('') }
    const setting = await SettingService.Get(WORKSPACE_LAYOUT_SETTING)
    if (!options.isCurrent()) return
    if (!setting) { completeRestore(options.runtime, options.restoreNonce); return }
    await restoreSavedWorkspace({ value: setting.value, ...options })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('restore workspace failed', error)
    if (!options.isCurrent()) return
    setError(message)
    setNotice('')
    options.runtime.completedNonceRef.current = options.restoreNonce
    options.runtime.observedSnapshot.current = null
    options.runtime.saveReady.current = false
  }
}

function useWorkspaceRestore(options: {
  sessionsLoaded: boolean
  settingsHydrated: boolean
  restoreNonce: number
  runtime: PersistenceRuntime
}) {
  useEffect(() => {
    if (!options.sessionsLoaded || !options.settingsHydrated) return
    if (options.runtime.completedNonceRef.current === options.restoreNonce) return
    options.runtime.saveReady.current = false
    const generation = ++options.runtime.generationRef.current
    let cancelled = false
    const isCurrent = () => !cancelled && generation === options.runtime.generationRef.current
    void runWorkspaceRestore({ runtime: options.runtime, restoreNonce: options.restoreNonce, isCurrent })
    return () => { cancelled = true }
  }, [options.sessionsLoaded, options.settingsHydrated, options.restoreNonce])
}

function useWorkspaceSave(options: {
  runtime: PersistenceRuntime
  snapshot: ReturnType<typeof createWorkspaceSnapshot>
}) {
  useEffect(() => {
    if (!options.runtime.saveReady.current) return
    const value = JSON.stringify(options.snapshot)
    if (options.runtime.observedSnapshot.current === value) return
    options.runtime.observedSnapshot.current = value
    const timer = window.setTimeout(() => options.runtime.saveQueueRef.current?.enqueue(value), SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [options.snapshot])
}

export function useWorkspacePersistence() {
  const { sessions, sessionsLoaded } = useSessionWorkspace()
  const settingsHydrated = useTerminalBehaviorStore((state) => state.settingsHydrated)
  const tabs = useAppStore((state) => state.tabs)
  const activeSurface = useAppStore((state) => state.activeSurface)
  const workspaceTab = useAppStore((state) => state.workspaceTab)
  const overviewSection = useAppStore((state) => state.overviewSection)
  const restoreNonce = useAppStore((state) => state.workspaceRestoreNonce)
  const runtime = usePersistenceRuntime(sessions)
  const snapshot = createWorkspaceSnapshot({ tabs, activeSurface, workspaceTab, overviewSection })
  useWorkspaceRestore({ sessionsLoaded, settingsHydrated, restoreNonce, runtime })
  useWorkspaceSave({ runtime, snapshot })
}
