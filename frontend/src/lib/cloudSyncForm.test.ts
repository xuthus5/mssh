import { describe, expect, it } from 'vitest'
import { createSyncInput, formatSyncBytes, formatSyncDate, hasUnsavedSyncChanges, syncEventStatusLabel, syncProviderLabel, syncStateLabel } from '@/lib/cloudSyncForm'
import { SyncEventStatus, SyncProvider, SyncState, SyncStrategy } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

const config = {
  enabled: true, master_key_saved: true, provider: SyncProvider.SyncProviderS3, strategy: SyncStrategy.SyncStrategyCloudFirst,
  interval_minutes: 30, retention_count: 20, retention_days: 60,
  gist: { gist_id: 'gist', token_saved: true }, webdav: { url: 'https://dav', username: 'u', password_saved: true },
  s3: { endpoint: 'https://s3', region: 'cn-test-1', bucket: 'bucket', prefix: 'mssh', access_key_id: 'key', secret_key_saved: true, path_style: true },
} as any

describe('cloud sync form helpers', () => {
  it('creates a secret-free input from saved configuration', () => {
    const input = createSyncInput(config)
    expect(input).toMatchObject({ enabled: true, provider: SyncProvider.SyncProviderS3, strategy: SyncStrategy.SyncStrategyCloudFirst, master_key: '', s3: { bucket: 'bucket', secret_key: '', path_style: true } })
    expect(hasUnsavedSyncChanges(input, config)).toBe(false)
    expect(hasUnsavedSyncChanges({ ...input, retention_count: 21 }, config)).toBe(true)
  })

  it('formats labels, dates, and byte sizes', () => {
    expect(syncProviderLabel(SyncProvider.SyncProviderGist)).toBe('GitHub Gist')
    expect(syncStateLabel(SyncState.SyncStateConflict)).toBe('存在冲突')
    expect(syncEventStatusLabel(SyncEventStatus.SyncEventNoop)).toBe('无变化')
    expect(formatSyncDate('')).toBe('尚未同步')
    expect(formatSyncDate('invalid')).toBe('invalid')
    expect(formatSyncBytes(100)).toBe('100 B')
    expect(formatSyncBytes(2048)).toBe('2.0 KB')
    expect(formatSyncBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
