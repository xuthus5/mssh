import { useCallback, useEffect, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { SyncService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import type { SyncConfigInput, SyncConflictChoice, SyncDashboard } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'
import { OperationBusyError } from '@/lib/operationBusyError'
import { syncDataChangedEvent } from '@/lib/syncDataReload'

interface SyncOperation {
  name: string
  success: string
  failure: string
  action: () => Promise<unknown>
  refresh?: boolean
  quiet?: boolean
}

export interface CloudSyncController {
  dashboard: SyncDashboard | null
  loading: boolean
  pending: string | null
  error: string | null
  reload: () => Promise<void>
  saveConfig: (input: SyncConfigInput, options?: { quiet?: boolean }) => Promise<void>
  testProvider: (input: SyncConfigInput) => Promise<void>
  syncNow: () => Promise<void>
  pushNow: () => Promise<void>
  pullNow: () => Promise<void>
  resolveConflict: (choice: SyncConflictChoice) => Promise<void>
  restoreVersion: (id: number) => Promise<void>
  deleteVersion: (id: number) => Promise<void>
  resetLocalData: () => Promise<void>
}

function useCloudSyncState() {
  const [dashboard, setDashboard] = useState<SyncDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lifecycle = useRef(0)
  const reloadRequest = useRef(0)
  const operationRequest = useRef(0)
  const operationActive = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current === token) lifecycle.current++
    }
  }, [])
  return {
    dashboard, setDashboard, loading, setLoading, pending, setPending, error, setError,
    lifecycle, reloadRequest, operationRequest, operationActive,
  }
}

type CloudSyncState = ReturnType<typeof useCloudSyncState>

function useCloudSyncReload(state: CloudSyncState) {
  const { lifecycle, reloadRequest, setDashboard, setError, setLoading } = state
  const reload = useCallback(async () => {
    const lifecycleToken = lifecycle.current
    const request = ++reloadRequest.current
    setLoading(true)
    try {
      const nextDashboard = await SyncService.Dashboard()
      if (lifecycle.current !== lifecycleToken || reloadRequest.current !== request) return
      setDashboard(nextDashboard)
      setError(null)
    } catch (loadError) {
      if (lifecycle.current !== lifecycleToken || reloadRequest.current !== request) return
      const message = errorMessage(loadError)
      setError(message)
      logger.error('load cloud sync dashboard failed', loadError)
    } finally {
      if (lifecycle.current === lifecycleToken && reloadRequest.current === request) setLoading(false)
    }
  }, [])
  return reload
}

function useCloudSyncExecute(state: CloudSyncState, reload: () => Promise<void>) {
  const { lifecycle, operationRequest, operationActive, reloadRequest, setError, setPending } = state
  return useCallback(async (operation: SyncOperation) => {
    if (operationActive.current) throw new OperationBusyError(t('同步操作正在进行'))
    operationActive.current = true
    const lifecycleToken = lifecycle.current
    const request = ++operationRequest.current
    reloadRequest.current++
    const isCurrent = () => lifecycle.current === lifecycleToken && operationRequest.current === request
    setPending(operation.name)
    setError(null)
    try {
      await operation.action()
      if (!isCurrent()) return
      if (operation.refresh !== false) await reload()
      if (isCurrent() && !operation.quiet) toast(operation.success, 'success')
    } catch (actionError) {
      if (!isCurrent()) throw actionError
      const message = errorMessage(actionError)
      reloadRequest.current++
      // Settings surface owns failures via page banner (error prop on tabs).
      setError(t(operation.failure, message))
      logger.error(`cloud sync ${operation.name} failed`, actionError)
      throw actionError
    } finally {
      if (operationRequest.current === request) operationActive.current = false
      if (isCurrent()) setPending(null)
    }
  }, [reload])
}

function createCloudSyncActions(execute: (operation: SyncOperation) => Promise<void>) {
  return {
    saveConfig: (input: SyncConfigInput, options?: { quiet?: boolean }) => execute({ name: 'save', success: t('同步配置已保存'), failure: '保存同步配置失败: ${}', action: () => SyncService.SaveConfig(input), quiet: options?.quiet === true }),
    testProvider: (input: SyncConfigInput) => execute({ name: 'test', success: t('连接测试成功'), failure: '同步连接测试失败: ${}', action: () => SyncService.TestProvider(input), refresh: false }),
    syncNow: () => execute({ name: 'sync', success: t('同步完成'), failure: '同步失败: ${}', action: () => SyncService.SyncNow() }),
    pushNow: () => execute({ name: 'push', success: t('本地版本已推送'), failure: '推送本地版本失败: ${}', action: () => SyncService.PushNow() }),
    pullNow: () => execute({ name: 'pull', success: t('云端版本已拉取'), failure: '拉取云端版本失败: ${}', action: () => SyncService.PullNow() }),
    resolveConflict: (choice: SyncConflictChoice) => execute({ name: 'resolve', success: t('同步冲突已处理'), failure: '处理同步冲突失败: ${}', action: () => SyncService.ResolveConflict(choice) }),
    restoreVersion: (id: number) => execute({ name: 'restore', success: t('本地版本已恢复'), failure: '恢复本地版本失败: ${}', action: () => SyncService.RestoreVersion(id) }),
    deleteVersion: (id: number) => execute({ name: 'delete', success: t('本地版本已删除'), failure: '删除本地版本失败: ${}', action: () => SyncService.DeleteVersion(id) }),
    resetLocalData: () => execute({ name: 'reset', success: t('本地业务数据已清空'), failure: '清空本地业务数据失败: ${}', action: () => SyncService.ResetLocalData() }),
  }
}

export function useCloudSyncCenter(): CloudSyncController {
  const state = useCloudSyncState()
  const reload = useCloudSyncReload(state)
  const execute = useCloudSyncExecute(state, reload)

  useEffect(() => { void reload() }, [reload])
  useEffect(() => Events.On(syncDataChangedEvent, () => { void reload() }), [reload])

  return {
    dashboard: state.dashboard, loading: state.loading, pending: state.pending, error: state.error, reload,
    ...createCloudSyncActions(execute),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
