import { describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { AutoReconnectScheduler, type AutoReconnectTask } from '@/hooks/autoReconnectScheduler'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function task(
  terminalID: string,
  run: () => Promise<void>,
  options: { tabID?: string; canRun?: () => boolean; cancel?: () => void } = {},
): AutoReconnectTask {
  return {
    terminalID,
    tabID: options.tabID ?? `tab-${terminalID}`,
    canRun: options.canRun ?? (() => true),
    run,
    cancel: options.cancel ?? (() => {}),
  }
}

describe('AutoReconnectScheduler', () => {
  it('runs tasks in FIFO order and deduplicates the same terminal', async () => {
    const first = deferred<void>()
    const order: string[] = []
    const scheduler = new AutoReconnectScheduler({ maxPending: 4, isBlocked: () => false })

    expect(scheduler.enqueue(task('one', async () => {
      order.push('one')
      await first.promise
    }))).toBe('enqueued')
    expect(scheduler.enqueue(task('one', async () => { order.push('duplicate') }))).toBe('duplicate')
    expect(scheduler.enqueue(task('two', async () => { order.push('two') }))).toBe('enqueued')

    await waitFor(() => expect(order).toEqual(['one']))
    first.resolve()
    await waitFor(() => expect(order).toEqual(['one', 'two']))
  })

  it('keeps queued work while blocked and resumes only after wake', async () => {
    let blocked = true
    const run = vi.fn(async () => {})
    const scheduler = new AutoReconnectScheduler({ maxPending: 2, isBlocked: () => blocked })

    scheduler.enqueue(task('one', run))
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()

    blocked = false
    scheduler.wake()
    await waitFor(() => expect(run).toHaveBeenCalledOnce())
  })

  it('bounds pending work and frees capacity after cancellation', () => {
    const scheduler = new AutoReconnectScheduler({ maxPending: 2, isBlocked: () => true })
    const cancel = vi.fn()

    expect(scheduler.enqueue(task('one', async () => {}, { cancel }))).toBe('enqueued')
    expect(scheduler.enqueue(task('two', async () => {}))).toBe('enqueued')
    expect(scheduler.enqueue(task('three', async () => {}))).toBe('full')

    scheduler.cancelTerminal('one')
    expect(cancel).toHaveBeenCalledOnce()
    expect(scheduler.enqueue(task('three', async () => {}))).toBe('enqueued')
  })

  it('cancels active and queued tab work without starting successors', async () => {
    const active = deferred<void>()
    const cancel = vi.fn(() => active.resolve())
    const started = vi.fn()
    const secondRun = vi.fn(async () => {})
    const secondCancel = vi.fn()
    const scheduler = new AutoReconnectScheduler({ maxPending: 4, isBlocked: () => false })

    scheduler.enqueue(task('one', async () => {
      started()
      await active.promise
    }, { tabID: 'shared', cancel }))
    await waitFor(() => expect(started).toHaveBeenCalledOnce())
    scheduler.enqueue(task('two', secondRun, { tabID: 'shared', cancel: secondCancel }))
    scheduler.cancelTab('shared')

    await waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(secondCancel).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(secondRun).not.toHaveBeenCalled()
  })

  it('prunes ineligible work and continues after task errors', async () => {
    const error = new Error('reconnect failed')
    const onError = vi.fn()
    const skipped = vi.fn(async () => {})
    const skipCancel = vi.fn()
    const completed = vi.fn(async () => {})
    const scheduler = new AutoReconnectScheduler({ maxPending: 4, isBlocked: () => false, onError })

    scheduler.enqueue(task('skip', skipped, { canRun: () => false, cancel: skipCancel }))
    scheduler.enqueue(task('fail', async () => { throw error }))
    scheduler.enqueue(task('done', completed))
    scheduler.prune()

    await waitFor(() => expect(completed).toHaveBeenCalledOnce())
    expect(skipped).not.toHaveBeenCalled()
    expect(skipCancel).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(error)
  })
})
