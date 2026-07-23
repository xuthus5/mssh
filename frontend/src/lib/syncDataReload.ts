import { Events } from '@wailsio/runtime'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'


export const syncDataChangedEvent = 'sync:data-changed'

export type SyncDataReloadHandler = () => void | Promise<void>

/** Hot-reload session workspace after cloud sync without hard page reload. */
type SilentList = (options?: { silent?: boolean }) => Promise<unknown>

export async function hotReloadSessionWorkspace(workspace: {
  listFolders: SilentList
  listSessions: SilentList
  listRecentSessions?: SilentList
  listAssetCatalogs?: SilentList
}): Promise<void> {
  // Nested list loaders must stay silent so this path owns a single failure toast.
  const silent = { silent: true as const }
  const tasks: Array<Promise<unknown>> = [
    workspace.listFolders(silent),
    workspace.listSessions(silent),
  ]
  if (workspace.listRecentSessions) tasks.push(workspace.listRecentSessions(silent))
  if (workspace.listAssetCatalogs) tasks.push(workspace.listAssetCatalogs(silent))
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
  confirmHardReload?: () => Promise<boolean> | boolean
}): SyncDataReloadHandler {
  const hardReload = options.hardReload ?? (() => { window.location.reload() })
  const confirmHardReload = options.confirmHardReload ?? defaultConfirmHardReload
  return async () => {
    try {
      await options.hotReload()
      toast(t('同步数据已刷新'), 'success')
    } catch (error: unknown) {
      logger.error('hot reload after sync failed', error)
      toast(t('同步后热更新失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
      if (await confirmHardReload()) hardReload()
    }
  }
}

async function defaultConfirmHardReload(): Promise<boolean> {
  const { requestConfirm } = await import('@/lib/confirmDialog')
  return requestConfirm({
    title: t('同步数据已变更'),
    description: t('热更新失败。是否重新加载应用？'),
    confirmLabel: t('重新加载'),
    cancelLabel: t('取消'),
    destructive: false,
  })
}
