import { describe, expect, it, vi } from 'vitest'
import { __clearHandlers, __emitEvent } from '@/test/__mocks__/wails-runtime'
import { registerSyncDataReload, syncDataChangedEvent } from '@/lib/syncDataReload'

describe('registerSyncDataReload', () => {
  it('reloads only while the listener is active', () => {
    __clearHandlers()
    const reload = vi.fn()
    const stop = registerSyncDataReload(reload)
    __emitEvent(syncDataChangedEvent, { data: { changed: true } })
    expect(reload).toHaveBeenCalledOnce()
    stop()
    __emitEvent(syncDataChangedEvent, { data: { changed: true } })
    expect(reload).toHaveBeenCalledOnce()
  })
})
