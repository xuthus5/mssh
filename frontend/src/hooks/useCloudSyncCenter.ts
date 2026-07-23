import { useCallback, useEffect, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { SyncService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import type { SyncConfigInput, SyncConflictChoice, SyncDashboard } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


const syncDataChangedEvent = 'sync:data-changed'

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

export function useCloudSyncCenter(): CloudSyncController {
  const [dashboard, setDashboard] = useState<SyncDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setDashboard(await SyncService.Dashboard())
      setError(null)
    } catch (loadError) {
      const message = errorMessage(loadError)
      setError(message)
      logger.error('load cloud sync dashboard failed', loadError)
    } finally {
      setLoading(false)
    }
  }, [])

  const execute = useCallback(async (operation: { name: string; success: string; failure: string; action: () => Promise<unknown>; refresh?: boolean; quiet?: boolean }) => {
    setPending(operation.name)
    setError(null)
    try {
      await operation.action()
      if (operation.refresh !== false) await reload()
      if (!operation.quiet) toast(operation.success, 'success')
    } catch (actionError) {
      const message = errorMessage(actionError)
      // Action failures use toast; load failures use page banner (setError in reload).
      toast(t(operation.failure, message), 'error')
      logger.error(`cloud sync ${operation.name} failed`, actionError)
      throw actionError
    } finally {
      setPending(null)
    }
  }, [reload])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => Events.On(syncDataChangedEvent, () => { void reload() }), [reload])

  return {
    dashboard, loading, pending, error, reload,
    saveConfig: (input, options) => execute({ name: 'save', success: t('同步配置已保存'), failure: '保存同步配置失败: ${}', action: () => SyncService.SaveConfig(input), quiet: options?.quiet === true }),
    testProvider: (input) => execute({ name: 'test', success: t('连接测试成功'), failure: '同步连接测试失败: ${}', action: () => SyncService.TestProvider(input), refresh: false }),
    syncNow: () => execute({ name: 'sync', success: t('同步完成'), failure: '同步失败: ${}', action: () => SyncService.SyncNow() }),
    pushNow: () => execute({ name: 'push', success: t('本地版本已推送'), failure: '推送本地版本失败: ${}', action: () => SyncService.PushNow() }),
    pullNow: () => execute({ name: 'pull', success: t('云端版本已拉取'), failure: '拉取云端版本失败: ${}', action: () => SyncService.PullNow() }),
    resolveConflict: (choice) => execute({ name: 'resolve', success: t('同步冲突已处理'), failure: '处理同步冲突失败: ${}', action: () => SyncService.ResolveConflict(choice) }),
    restoreVersion: (id) => execute({ name: 'restore', success: t('本地版本已恢复'), failure: '恢复本地版本失败: ${}', action: () => SyncService.RestoreVersion(id) }),
    deleteVersion: (id) => execute({ name: 'delete', success: t('本地版本已删除'), failure: '删除本地版本失败: ${}', action: () => SyncService.DeleteVersion(id) }),
    resetLocalData: () => execute({ name: 'reset', success: t('本地业务数据已清空'), failure: '清空本地业务数据失败: ${}', action: () => SyncService.ResetLocalData() }),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
