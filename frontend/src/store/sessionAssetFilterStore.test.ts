import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionAssetFilterStore } from '@/store/sessionAssetFilterStore'

describe('session asset filter store', () => {
  beforeEach(() => useSessionAssetFilterStore.getState().resetFilters())

  it('retains filters for the current application lifetime without persistence', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    useSessionAssetFilterStore.getState().setFilters({ query: '生产', tagIds: ['tag'] })
    expect(useSessionAssetFilterStore.getState().filters).toMatchObject({ query: '生产', tagIds: ['tag'] })
    expect(storage).not.toHaveBeenCalled()
    useSessionAssetFilterStore.getState().resetFilters()
    expect(useSessionAssetFilterStore.getState().filters).toMatchObject({ query: '', tagIds: [] })
    storage.mockRestore()
  })
})
