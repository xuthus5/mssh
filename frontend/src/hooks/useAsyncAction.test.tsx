import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAsyncAction } from '@/hooks/useAsyncAction'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

describe('useAsyncAction', () => {
  it('deduplicates repeated submissions and reports success', async () => {
    const pending = deferred<string>()
    const action = vi.fn(() => pending.promise)
    const { result } = renderHook(() => useAsyncAction(action))
    let first!: Promise<string>
    let second!: Promise<string>
    act(() => { first = result.current.run(); second = result.current.run() })
    expect(first).toBe(second)
    expect(action).toHaveBeenCalledOnce()
    expect(result.current.pending).toBe(true)
    await act(async () => pending.resolve('done'))
    expect(result.current).toMatchObject({ status: 'success', result: 'done', error: '' })
  })

  it('prevents stale latest responses from replacing newer results', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const action = vi.fn((value: string) => value === 'first' ? first.promise : second.promise)
    const { result } = renderHook(() => useAsyncAction(action, 'latest'))
    let firstRun!: Promise<string>
    let secondRun!: Promise<string>
    act(() => { firstRun = result.current.run('first'); secondRun = result.current.run('second') })
    await act(async () => second.resolve('new'))
    expect(result.current.result).toBe('new')
    await act(async () => first.resolve('old'))
    await Promise.all([firstRun, secondRun])
    expect(result.current.result).toBe('new')
  })

  it('reports errors and supports reset', async () => {
    const action = vi.fn(async () => { throw new Error('failed') })
    const { result } = renderHook(() => useAsyncAction(action))
    await act(async () => { await result.current.run().catch(() => undefined) })
    expect(result.current).toMatchObject({ status: 'error', error: 'failed' })
    act(() => result.current.reset())
    expect(result.current.status).toBe('idle')
  })
})
