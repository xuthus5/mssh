import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCloudSyncCenter } from '@/hooks/useCloudSyncCenter'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { createSyncInput } from '@/lib/cloudSyncForm'
import { SyncProvider, SyncState, SyncStrategy } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

const dashboard = {
  config: { enabled: true, master_key_saved: true, provider: SyncProvider.SyncProviderGist, strategy: SyncStrategy.SyncStrategySmart, interval_minutes: 15, retention_count: 30, retention_days: 90, gist: { gist_id: 'gist', token_saved: true }, webdav: { url: '', username: '', password_saved: false }, s3: { endpoint: '', region: 'us-east-1', bucket: '', prefix: '', access_key_id: '', secret_key_saved: false, path_style: false } },
  state: SyncState.SyncStateIdle, message: '', last_synced_at: '', local_version: null, remote_version: null, conflict: null, versions: [], events: [],
}

describe('useCloudSyncCenter', () => {
  let dashboardLoads = 0

  beforeEach(() => {
    __clearHandlers()
    dashboardLoads = 0
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.Dashboard', async () => { dashboardLoads++; return dashboard })
  })

  it('loads, saves, and refreshes the dashboard', async () => {
    let saved: unknown
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.SaveConfig', async (input) => { saved = input; return dashboard })
    const { result } = renderHook(() => useCloudSyncCenter())
    await waitFor(() => expect(result.current.dashboard?.config.gist.gist_id).toBe('gist'))
    await act(async () => { await result.current.saveConfig(createSyncInput(dashboard.config as any)) })
    expect(saved).toMatchObject({ provider: SyncProvider.SyncProviderGist })
    expect(dashboardLoads).toBeGreaterThan(1)
  })

  it('reloads after destructive data-change events', async () => {
    const { result } = renderHook(() => useCloudSyncCenter())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const previousLoads = dashboardLoads
    act(() => __emitEvent('sync:data-changed', { data: { changed: true } }))
    await waitFor(() => expect(dashboardLoads).toBeGreaterThan(previousLoads))
  })

  it('surfaces operation failures without losing the dashboard', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.SyncNow', async () => { throw new Error('network failed') })
    const { result } = renderHook(() => useCloudSyncCenter())
    await waitFor(() => expect(result.current.dashboard).not.toBeNull())
    await act(async () => { await result.current.syncNow().catch(() => undefined) })
    expect(result.current.error).toBe('network failed')
    expect(result.current.pending).toBeNull()
  })

  it('exposes every sync operation through the controller', async () => {
    const resultValue = { state: SyncState.SyncStateSynced, message: 'ok', conflict: null }
    for (const method of ['TestProvider', 'SyncNow', 'PushNow', 'PullNow', 'ResolveConflict']) {
      __registerHandler(`github.com/xuthus5/mssh/internal/service.SyncService.${method}`, async () => resultValue)
    }
    for (const method of ['RestoreVersion', 'DeleteVersion', 'ResetLocalData']) {
      __registerHandler(`github.com/xuthus5/mssh/internal/service.SyncService.${method}`, async () => undefined)
    }
    const { result } = renderHook(() => useCloudSyncCenter())
    await waitFor(() => expect(result.current.dashboard).not.toBeNull())
    await act(async () => {
      await result.current.testProvider(createSyncInput(dashboard.config as any))
      await result.current.syncNow()
      await result.current.pushNow()
      await result.current.pullNow()
      await result.current.resolveConflict('cancel' as any)
      await result.current.restoreVersion(1)
      await result.current.deleteVersion(1)
      await result.current.resetLocalData()
    })
    expect(result.current.pending).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('quiet saveConfig still surfaces error toasts', async () => {
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.SaveConfig', async () => {
      throw new Error('save config failed')
    })
    const { result } = renderHook(() => useCloudSyncCenter())
    await waitFor(() => expect(result.current.dashboard).not.toBeNull())
    await act(async () => {
      await result.current.saveConfig(createSyncInput(dashboard.config as any), { quiet: true }).catch(() => undefined)
    })
    expect(result.current.error).toBe('save config failed')
    const messages = useToastStore.getState().toasts.map((item) => `${item.type}:${item.message}`)
    expect(messages.some((item) => item.startsWith('error:') && item.includes('失败'))).toBe(true)
  })
})
