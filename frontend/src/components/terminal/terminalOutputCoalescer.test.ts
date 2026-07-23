import { describe, expect, it, vi } from 'vitest'
import { TerminalOutputCoalescer } from '@/components/terminal/terminalOutputCoalescer'

describe('TerminalOutputCoalescer', () => {
  it('passes through immediately when coalescing is disabled', () => {
    const write = vi.fn()
    const coalescer = new TerminalOutputCoalescer(write, { shouldCoalesce: () => false })
    coalescer.push(new Uint8Array([1, 2]))
    expect(write).toHaveBeenCalledOnce()
    expect(Array.from(write.mock.calls[0][0])).toEqual([1, 2])
  })

  it('batches inactive bursts until delay elapses', () => {
    const write = vi.fn()
    const timers: Array<{ id: number; cb: () => void }> = []
    let nextID = 1
    const coalescer = new TerminalOutputCoalescer(write, {
      maxDelayMs: 20,
      shouldCoalesce: () => true,
      schedule: (cb) => {
        const id = nextID++
        timers.push({ id, cb })
        return id
      },
      cancel: (id) => {
        const index = timers.findIndex((item) => item.id === id)
        if (index >= 0) timers.splice(index, 1)
      },
    })
    coalescer.push(new Uint8Array([1]))
    coalescer.push(new Uint8Array([2, 3]))
    expect(write).not.toHaveBeenCalled()
    expect(timers).toHaveLength(1)
    timers[0].cb()
    expect(write).toHaveBeenCalledOnce()
    expect(Array.from(write.mock.calls[0][0])).toEqual([1, 2, 3])
  })

  it('flushes early when byte budget is exceeded', () => {
    const write = vi.fn()
    const coalescer = new TerminalOutputCoalescer(write, {
      maxBytes: 4,
      shouldCoalesce: () => true,
      schedule: () => 1,
      cancel: () => {},
    })
    coalescer.push(new Uint8Array([1, 2, 3]))
    expect(write).not.toHaveBeenCalled()
    coalescer.push(new Uint8Array([4, 5]))
    expect(write).toHaveBeenCalledOnce()
    expect(Array.from(write.mock.calls[0][0])).toEqual([1, 2, 3, 4, 5])
  })

  it('flush/dispose empties the buffer', () => {
    const write = vi.fn()
    const coalescer = new TerminalOutputCoalescer(write, {
      shouldCoalesce: () => true,
      schedule: () => 1,
      cancel: () => {},
    })
    coalescer.push(new Uint8Array([9]))
    coalescer.dispose()
    expect(write).toHaveBeenCalledOnce()
    expect(Array.from(write.mock.calls[0][0])).toEqual([9])
  })

  it('exposes pass-through and batch metrics', () => {
    const write = vi.fn()
    const coalescer = new TerminalOutputCoalescer(write, {
      shouldCoalesce: () => false,
    })
    coalescer.push(new Uint8Array([1]))
    expect(coalescer.getMetrics()).toMatchObject({
      pushedChunks: 1,
      passThroughChunks: 1,
      flushedBatches: 0,
    })

    const batching = new TerminalOutputCoalescer(write, {
      shouldCoalesce: () => true,
      schedule: () => 1,
      cancel: () => {},
    })
    batching.push(new Uint8Array([2, 3]))
    batching.flush()
    expect(batching.getMetrics()).toMatchObject({
      pushedChunks: 1,
      flushedBatches: 1,
      flushedBytes: 2,
    })
  })
})
