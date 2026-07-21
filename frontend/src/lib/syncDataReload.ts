import { Events } from '@wailsio/runtime'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'


export const syncDataChangedEvent = 'sync:data-changed'

export type SyncDataReloadHandler = () => void | Promise<void>

/** Hot-reload session workspace after cloud sync without hard page reload. */
export async function hotReloadSessionWorkspace(workspace: {
  listFolders: () => Promise<unknown>
  listSessions: () => Promise<unknown>
  listRecentSessions?: () => Promise<unknown>
  listAssetCatalogs?: () => Promise<unknown>
  listTunnels?: () => Promise<unknown>
}): Promise<void> {
  const tasks: Array<Promise<unknown>> = [
    workspace.listFolders(),
    workspace.listSessions(),
  ]
  if (workspace.listRecentSessions) tasks.push(workspace.listRecentSessions())
  if (workspace.listAssetCatalogs) tasks.push(workspace.listAssetCatalogs())
  if (workspace.listTunnels) tasks.push(workspace.listTunnels())
  await Promise.all(tasks)
}

export function registerSyncDataReload(reload: SyncDataReloadHandler): () => void {
  return Events.On(syncDataChangedEvent, () => {
    void Promise.resolve(reload()).catch((error: unknown) => {
      logger.error('sync data reload failed', error)
      toast(t('同步后刷新失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    })
  })
}

/**
 * Build the App-level sync listener: prefer hot reload; only hard-reload after user confirm if hot path fails hard.
 */
export function createAppSyncDataReload(options: {
  hotReload: () => Promise<void>
  hardReload?: () => void
  confirmHardReload?: () => boolean
}): SyncDataReloadHandler {
  const hardReload = options.hardReload ?? (() => { window.location.reload() })
  const confirmHardReload = options.confirmHardReload ?? (() => window.confirm(t('同步数据已变更，热更新失败。是否重新加载应用？')))
  return async () => {
    try {
      await options.hotReload()
      toast(t('同步数据已刷新'), 'success')
    } catch (error: unknown) {
      logger.error('hot reload after sync failed', error)
      toast(t('同步后热更新失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
      if (confirmHardReload()) hardReload()
    }
  }
}
