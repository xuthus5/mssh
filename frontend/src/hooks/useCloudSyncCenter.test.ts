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

  it('surfaces operation failures on the page banner without toast', async () => {
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.SyncNow', async () => { throw new Error('network failed') })
    const { result } = renderHook(() => useCloudSyncCenter())
    await waitFor(() => expect(result.current.dashboard).not.toBeNull())
    await act(async () => { await result.current.syncNow().catch(() => undefined) })
    expect(result.current.error).toContain('network failed')
    expect(result.current.pending).toBeNull()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
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

  it('quiet saveConfig still surfaces page errors without toast', async () => {
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
    expect(result.current.error).toContain('save config failed')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('sets page error when dashboard load fails without toast', async () => {
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.Dashboard', async () => {
      throw new Error('dashboard load failed')
    })
    const { result } = renderHook(() => useCloudSyncCenter())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('dashboard load failed')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('does not let an older dashboard reload overwrite a newer one', async () => {
    const first = deferred<typeof dashboard>()
    const second = deferred<typeof dashboard>()
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.Dashboard', async () => { dashboardLoads++; return first.promise })
    const { result } = renderHook(() => useCloudSyncCenter())
    await waitFor(() => expect(dashboardLoads).toBe(1))

    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.Dashboard', async () => { dashboardLoads++; return second.promise })
    let latestReload!: Promise<void>
    act(() => { latestReload = result.current.reload() })
    await waitFor(() => expect(dashboardLoads).toBe(2))
    const newer = { ...dashboard, config: { ...dashboard.config, gist: { ...dashboard.config.gist, gist_id: 'new' } } }
    await act(async () => { second.resolve(newer); await latestReload })
    expect(result.current.dashboard?.config.gist.gist_id).toBe('new')

    const older = { ...dashboard, config: { ...dashboard.config, gist: { ...dashboard.config.gist, gist_id: 'old' } } }
    await act(async () => { first.resolve(older); await first.promise })
    expect(result.current.dashboard?.config.gist.gist_id).toBe('new')
  })

  it('keeps an operation failure when an earlier event reload resolves later', async () => {
    const sync = deferred<void>()
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.SyncNow', async () => sync.promise)
    const { result } = renderHook(() => useCloudSyncCenter())
    await waitFor(() => expect(result.current.dashboard).not.toBeNull())

    const eventReload = deferred<typeof dashboard>()
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.Dashboard', async () => {
      dashboardLoads++
      return eventReload.promise
    })
    let syncPromise!: Promise<void>
    act(() => { syncPromise = result.current.syncNow() })
    await waitFor(() => expect(result.current.pending).toBe('sync'))
    act(() => __emitEvent('sync:data-changed', { data: { changed: true } }))

    await act(async () => {
      sync.reject(new Error('network failed'))
      await syncPromise.catch(() => undefined)
    })
    expect(result.current.error).toContain('network failed')

    await act(async () => {
      eventReload.resolve(dashboard)
      await eventReload.promise
    })
    expect(result.current.error).toContain('network failed')
  })

  it('rejects overlapping sync operations without calling a second backend action', async () => {
    const sync = deferred<void>()
    let pushes = 0
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.SyncNow', async () => sync.promise)
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.PushNow', async () => { pushes++; return undefined })
    const { result } = renderHook(() => useCloudSyncCenter())
    await waitFor(() => expect(result.current.dashboard).not.toBeNull())

    let syncPromise!: Promise<void>
    let pushPromise!: Promise<void>
    act(() => {
      syncPromise = result.current.syncNow()
      pushPromise = result.current.pushNow()
    })

    await expect(pushPromise).rejects.toThrow('同步操作正在进行')
    expect(pushes).toBe(0)
    expect(result.current.pending).toBe('sync')

    await act(async () => { sync.resolve(undefined); await syncPromise })
    expect(result.current.pending).toBeNull()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
