import { useCallback, useEffect, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { SyncService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import type { SyncConfigInput, SyncConflictChoice, SyncDashboard } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

const syncDataChangedEvent = 'sync:data-changed'

export interface CloudSyncController {
  dashboard: SyncDashboard | null
  loading: boolean
  pending: string | null
  error: string | null
  reload: () => Promise<void>
  saveConfig: (input: SyncConfigInput) => Promise<void>
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
      setError(errorMessage(loadError))
      logger.error('load cloud sync dashboard failed', loadError)
    } finally {
      setLoading(false)
    }
  }, [])

  const execute = useCallback(async (operation: { name: string; success: string; action: () => Promise<unknown>; refresh?: boolean }) => {
    setPending(operation.name)
    setError(null)
    try {
      await operation.action()
      if (operation.refresh !== false) await reload()
      toast(operation.success, 'success')
    } catch (actionError) {
      const message = errorMessage(actionError)
      setError(message)
      toast(`${operation.success.replace(/成功|完成/g, '')}失败: ${message}`, 'error')
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
    saveConfig: (input) => execute({ name: 'save', success: '同步配置已保存', action: () => SyncService.SaveConfig(input) }),
    testProvider: (input) => execute({ name: 'test', success: '连接测试成功', action: () => SyncService.TestProvider(input), refresh: false }),
    syncNow: () => execute({ name: 'sync', success: '同步完成', action: () => SyncService.SyncNow() }),
    pushNow: () => execute({ name: 'push', success: '本地版本已推送', action: () => SyncService.PushNow() }),
    pullNow: () => execute({ name: 'pull', success: '云端版本已拉取', action: () => SyncService.PullNow() }),
    resolveConflict: (choice) => execute({ name: 'resolve', success: '同步冲突已处理', action: () => SyncService.ResolveConflict(choice) }),
    restoreVersion: (id) => execute({ name: 'restore', success: '本地版本已恢复', action: () => SyncService.RestoreVersion(id) }),
    deleteVersion: (id) => execute({ name: 'delete', success: '本地版本已删除', action: () => SyncService.DeleteVersion(id) }),
    resetLocalData: () => execute({ name: 'reset', success: '本地业务数据已清空', action: () => SyncService.ResetLocalData() }),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
