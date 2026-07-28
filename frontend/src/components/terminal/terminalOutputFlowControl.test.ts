import { describe, expect, it, vi } from 'vitest'
import { TerminalOutputFlowControl } from '@/components/terminal/terminalOutputFlowControl'

const bytes = (value: string) => new TextEncoder().encode(value)

describe('TerminalOutputFlowControl', () => {
  it('serializes writes and preserves byte order across backpressure', () => {
    const writes: Uint8Array[] = []
    const callbacks: Array<() => void> = []
    const pause = vi.fn()
    const resume = vi.fn()
    const flow = new TerminalOutputFlowControl({
      write: (data, callback) => {
        writes.push(data)
        callbacks.push(callback)
        return true
      },
      pause,
      resume,
      highWaterBytes: 5,
      lowWaterBytes: 2,
    })

    flow.push(bytes('abc'))
    flow.push(bytes('def'))
    expect(writes.map((item) => new TextDecoder().decode(item))).toEqual(['abc'])
    expect(pause).toHaveBeenCalledOnce()
    callbacks.shift()?.()
    callbacks.shift()?.()

    expect(writes.map((item) => new TextDecoder().decode(item))).toEqual(['abc', 'def'])
    expect(resume).toHaveBeenCalledOnce()
    expect(flow.getMetrics()).toMatchObject({ pendingBytes: 0, inFlightBytes: 0, paused: false })
  })

  it('releases the backend pause when disposed', () => {
    const resume = vi.fn()
    const flow = new TerminalOutputFlowControl({
      write: () => true,
      pause: vi.fn(),
      resume,
      highWaterBytes: 1,
      lowWaterBytes: 0,
    })
    flow.push(bytes('x'))
    flow.dispose()
    expect(resume).toHaveBeenCalledOnce()
    expect(flow.getMetrics()).toMatchObject({ pendingBytes: 0, paused: false })
  })

  it('rejects inverted watermarks and reports synchronous write failure', () => {
    expect(() => new TerminalOutputFlowControl({
      write: () => true,
      pause: vi.fn(),
      resume: vi.fn(),
      highWaterBytes: 1,
      lowWaterBytes: 1,
    })).toThrow('low water mark')

    const failure = vi.fn()
    const flow = new TerminalOutputFlowControl({
      write: () => false,
      pause: vi.fn(),
      resume: vi.fn(),
      onWriteFailure: failure,
    })
    flow.push(bytes('failed'))
    expect(failure).toHaveBeenCalledOnce()
    expect(flow.getMetrics()).toMatchObject({ pendingBytes: 0, inFlightBytes: 0 })
  })

  it('settles a parser callback only once and disables failed backend flow control', () => {
    const callback: Array<() => void> = []
    const pause = vi.fn()
    const flow = new TerminalOutputFlowControl({
      write: (_data, onParsed) => { callback.push(onParsed); return true },
      pause,
      resume: vi.fn(),
      highWaterBytes: 1,
      lowWaterBytes: 0,
    })
    flow.push(bytes('x'))
    expect(pause).toHaveBeenCalledOnce()
    flow.disableFlowControl()
    callback[0]()
    callback[0]()
    expect(flow.getMetrics()).toMatchObject({ inFlightBytes: 0, completedWrites: 1, paused: false })
  })

  it('keeps queued and future output when backend flow control becomes unavailable', () => {
    const callbacks: Array<() => void> = []
    const writes: Uint8Array[] = []
    const flow = new TerminalOutputFlowControl({
      write: (data, onParsed) => {
        writes.push(data)
        callbacks.push(onParsed)
        return true
      },
      pause: vi.fn(),
      resume: vi.fn(),
    })

    flow.push(bytes('first'))
    flow.push(bytes('queued'))
    flow.disableFlowControl()
    flow.push(bytes('future'))

    expect(writes).toHaveLength(1)
    expect(flow.getMetrics()).toMatchObject({ pendingBytes: 12, paused: false })
    callbacks[0]?.()
    expect(writes.map((item) => new TextDecoder().decode(item))).toEqual(['first', 'queued'])
    callbacks[1]?.()
    expect(writes.map((item) => new TextDecoder().decode(item))).toEqual(['first', 'queued', 'future'])
    callbacks[2]?.()
    expect(flow.getMetrics()).toMatchObject({ pendingBytes: 0, inFlightBytes: 0, paused: false })
  })
})
