import { describe, expect, it, vi, beforeEach } from 'vitest'
import { __clearHandlers, __emitEvent } from '@/test/__mocks__/wails-runtime'

const toast = vi.hoisted(() => vi.fn())
const loggerError = vi.hoisted(() => vi.fn())

vi.mock('@/components/ui/toast', () => ({ toast }))
vi.mock('@/lib/logger', () => ({ logger: { error: loggerError, debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import {
  createAppSyncDataReload,
  hotReloadSessionWorkspace,
  registerSyncDataReload,
  syncDataChangedEvent,
} from '@/lib/syncDataReload'

describe('registerSyncDataReload', () => {
  beforeEach(() => {
    __clearHandlers()
    toast.mockReset()
    loggerError.mockReset()
  })

  it('reloads only while the listener is active', () => {
    const reload = vi.fn()
    const stop = registerSyncDataReload(reload)
    __emitEvent(syncDataChangedEvent, { data: { changed: true } })
    expect(reload).toHaveBeenCalledOnce()
    stop()
    __emitEvent(syncDataChangedEvent, { data: { changed: true } })
    expect(reload).toHaveBeenCalledOnce()
  })

  it('toasts when the reload handler rejects', async () => {
    registerSyncDataReload(async () => {
      throw new Error('boom')
    })
    __emitEvent(syncDataChangedEvent, {})
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('同步后刷新失败: boom', 'error'))
    expect(loggerError).toHaveBeenCalled()
  })
})

describe('hotReloadSessionWorkspace', () => {
  it('refreshes required lists and optional catalogs in parallel', async () => {
    const workspace = {
      listFolders: vi.fn(async () => ['f']),
      listSessions: vi.fn(async () => ['s']),
      listRecentSessions: vi.fn(async () => ['r']),
      listAssetCatalogs: vi.fn(async () => ['a']),
    }
    await hotReloadSessionWorkspace(workspace)
    expect(workspace.listFolders).toHaveBeenCalledWith({ silent: true })
    expect(workspace.listSessions).toHaveBeenCalledWith({ silent: true })
    expect(workspace.listRecentSessions).toHaveBeenCalledWith({ silent: true })
    expect(workspace.listAssetCatalogs).toHaveBeenCalledWith({ silent: true })
  })

  it('only requires folders and sessions when optional loaders are absent', async () => {
    const workspace = {
      listFolders: vi.fn(async () => []),
      listSessions: vi.fn(async () => []),
    }
    await hotReloadSessionWorkspace(workspace)
    expect(workspace.listFolders).toHaveBeenCalledWith({ silent: true })
    expect(workspace.listSessions).toHaveBeenCalledWith({ silent: true })
  })
})

describe('createAppSyncDataReload', () => {
  beforeEach(() => {
    toast.mockReset()
    loggerError.mockReset()
  })

  it('hot-reloads and toasts success without hard reload', async () => {
    const hotReload = vi.fn(async () => {})
    const hardReload = vi.fn()
    const confirmHardReload = vi.fn(() => true)
    const handler = createAppSyncDataReload({ hotReload, hardReload, confirmHardReload })
    await handler()
    expect(hotReload).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledWith('同步数据已刷新', 'success')
    expect(hardReload).not.toHaveBeenCalled()
    expect(confirmHardReload).not.toHaveBeenCalled()
  })

  it('prompts for hard reload only after hot reload fails and user confirms', async () => {
    const hotReload = vi.fn(async () => { throw new Error('stale') })
    const hardReload = vi.fn()
    const confirmHardReload = vi.fn(() => true)
    const handler = createAppSyncDataReload({ hotReload, hardReload, confirmHardReload })
    await handler()
    expect(toast).toHaveBeenCalledWith('同步后热更新失败: stale', 'error')
    expect(confirmHardReload).toHaveBeenCalledOnce()
    expect(hardReload).toHaveBeenCalledOnce()
  })

  it('does not hard-reload when the user cancels the confirm dialog', async () => {
    const hotReload = vi.fn(async () => { throw new Error('stale') })
    const hardReload = vi.fn()
    const handler = createAppSyncDataReload({
      hotReload,
      hardReload,
      confirmHardReload: () => false,
    })
    await handler()
    expect(hardReload).not.toHaveBeenCalled()
  })
})
