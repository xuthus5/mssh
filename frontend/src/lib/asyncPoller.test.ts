import { afterEach, describe, expect, it, vi } from 'vitest'
import { AsyncPoller } from '@/lib/asyncPoller'

describe('AsyncPoller', () => {
  afterEach(() => vi.useRealTimers())

  it('waits for the active task before scheduling the next poll', async () => {
    vi.useFakeTimers()
    const first = deferred<void>()
    const task = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined)
    const poller = new AsyncPoller({ task, delayMs: 1000, onError: vi.fn() })

    void poller.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(task).toHaveBeenCalledOnce()

    first.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(999)
    expect(task).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('coalesces triggers received while a task is active', async () => {
    const first = deferred<void>()
    const task = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined)
    const poller = new AsyncPoller({ task, delayMs: 1000, onError: vi.fn() })

    void poller.start()
    const queued = poller.trigger()
    void poller.trigger()
    expect(task).toHaveBeenCalledOnce()

    first.resolve()
    await queued
    expect(task).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('stops future work while an active task settles', async () => {
    vi.useFakeTimers()
    const first = deferred<void>()
    const task = vi.fn(() => first.promise)
    const poller = new AsyncPoller({ task, delayMs: 1000, onError: vi.fn() })

    void poller.start()
    poller.stop()
    first.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5000)
    expect(task).toHaveBeenCalledOnce()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
