import {
  SyncProvider,
  SyncState,
  SyncStrategy,
  type SyncConfig,
  type SyncConfigInput,
  type SyncEventStatus,
} from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

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
  return ({ gist: 'GitHub Gist', webdav: 'WebDAV', s3: 'S3' } as Record<string, string>)[provider] ?? '未配置'
}

export function syncStateLabel(state: SyncState): string {
  return ({ disabled: '未启用', idle: '待同步', syncing: '同步中', synced: '已同步', pending: '有本地变更', conflict: '存在冲突', error: '同步失败' } as Record<string, string>)[state] ?? '未知'
}

export function syncEventStatusLabel(status: SyncEventStatus): string {
  return ({ success: '成功', failed: '失败', conflict: '冲突', noop: '无变化' } as Record<string, string>)[status] ?? '未知'
}

export function formatSyncDate(value?: string): string {
  if (!value) return '尚未同步'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

export function formatSyncBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
