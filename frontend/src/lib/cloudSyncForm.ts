import {
  SyncProvider,
  SyncState,
  SyncStrategy,
  type SyncConfig,
  type SyncConfigInput,
  type SyncEventStatus,
} from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


export function createSyncInput(config?: SyncConfig): SyncConfigInput {
  return {
    enabled: config?.enabled ?? false,
    provider: config?.provider || SyncProvider.SyncProviderGist,
    strategy: config?.strategy || SyncStrategy.SyncStrategySmart,
    interval_minutes: config?.interval_minutes ?? 15,
    retention_count: config?.retention_count ?? 30,
    retention_days: config?.retention_days ?? 90,
    master_key: '',
    gist: { gist_id: config?.gist.gist_id ?? '', token: '', clear_token: false },
    webdav: { url: config?.webdav.url ?? '', username: config?.webdav.username ?? '', password: '', clear_password: false },
    s3: {
      endpoint: config?.s3.endpoint ?? '', region: config?.s3.region || 'us-east-1', bucket: config?.s3.bucket ?? '',
      prefix: config?.s3.prefix ?? '', access_key_id: config?.s3.access_key_id ?? '', secret_key: '',
      clear_secret_key: false, path_style: config?.s3.path_style ?? false,
    },
  }
}

export function hasUnsavedSyncChanges(input: SyncConfigInput, config?: SyncConfig): boolean {
  if (!config) return true
  const saved = createSyncInput(config)
  return JSON.stringify(input) !== JSON.stringify(saved)
}

export function syncProviderLabel(provider: SyncProvider): string {
  return ({ gist: 'GitHub Gist', webdav: 'WebDAV', s3: 'S3' } as Record<string, string>)[provider] ?? t('未配置')
}

export function syncStateLabel(state: SyncState): string {
  return ({ disabled: t('未启用'), idle: t('待同步'), syncing: t('同步中'), synced: t('已同步'), pending: t('有本地变更'), conflict: t('存在冲突'), error: t('同步失败') } as Record<string, string>)[state] ?? t('未知')
}

export function syncEventStatusLabel(status: SyncEventStatus): string {
  return ({ success: t('成功'), failed: t('失败'), conflict: t('冲突'), noop: t('无变化') } as Record<string, string>)[status] ?? t('未知')
}

export function formatSyncDate(value?: string): string {
  if (!value) return t('尚未同步')
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

export function formatSyncBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
