import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const modelsDevCatalog = vi.hoisted(() => vi.fn())
vi.mock('@/lib/wails', () => ({ AIService: { ModelsDevCatalog: modelsDevCatalog } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

import { useModelsDevCatalog } from '@/hooks/useModelsDevCatalog'

describe('useModelsDevCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelsDevCatalog.mockResolvedValue(catalog('openai'))
  })

  it('loads cached data and refreshes on demand', async () => {
    const { result } = renderHook(() => useModelsDevCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(modelsDevCatalog).toHaveBeenCalledWith(false)
    expect(result.current.catalog?.providers[0].id).toBe('openai')

    modelsDevCatalog.mockResolvedValueOnce(catalog('anthropic'))
    await act(async () => { await result.current.refresh() })
    expect(modelsDevCatalog).toHaveBeenLastCalledWith(true)
    expect(result.current.catalog?.providers[0].id).toBe('anthropic')
  })

  it('keeps existing data when refresh fails', async () => {
    const { result } = renderHook(() => useModelsDevCatalog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    modelsDevCatalog.mockRejectedValueOnce(new Error('offline'))

    await act(async () => { await result.current.refresh() })

    expect(result.current.catalog?.providers[0].id).toBe('openai')
    expect(result.current.error).toBe('offline')
  })

  it('ignores a stale initial response after a refresh', async () => {
    const initial = deferred<ReturnType<typeof catalog>>()
    const refreshed = deferred<ReturnType<typeof catalog>>()
    modelsDevCatalog.mockReset().mockReturnValueOnce(initial.promise).mockReturnValueOnce(refreshed.promise)
    const { result } = renderHook(() => useModelsDevCatalog())
    await waitFor(() => expect(modelsDevCatalog).toHaveBeenCalledOnce())

    let refresh!: Promise<void>
    act(() => { refresh = result.current.refresh() })
    await act(async () => { refreshed.resolve(catalog('google')); await refresh })
    await act(async () => { initial.resolve(catalog('openai')); await initial.promise })

    expect(result.current.catalog?.providers[0].id).toBe('google')
  })
})

function catalog(id: string) {
  return { providers: [{ id, name: id, provider: 'openai_compatible', base_url: 'https://example.com', models: [] }], cached_at: '' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
