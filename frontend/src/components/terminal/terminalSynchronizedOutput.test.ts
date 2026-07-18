import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SynchronizedOutputWriter } from '@/components/terminal/terminalSynchronizedOutput'

const syncStart = '\u001b[?2026h'
const syncEnd = '\u001b[?2026l'

describe('SynchronizedOutputWriter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('writes ordinary output immediately', () => {
    const write = vi.fn()
    const output = new SynchronizedOutputWriter(write)

    output.push('hello')

    expect(write).toHaveBeenCalledWith('hello')
  })

  it('buffers a Codex frame across arbitrary SSH chunks', () => {
    const write = vi.fn()
    const output = new SynchronizedOutputWriter(write)

    output.push(`prompt${syncStart.slice(0, 5)}`)
    expect(write).toHaveBeenCalledWith('prompt')
    output.push(`${syncStart.slice(5)}\u001b[3;1H\u001b[J`)
    output.push('working')
    expect(write).toHaveBeenCalledTimes(1)
    output.push(`${syncEnd.slice(0, 6)}`)
    expect(write).toHaveBeenCalledTimes(1)
    output.push(`${syncEnd.slice(6)}done`)

    expect(write).toHaveBeenNthCalledWith(2, '\u001b[3;1H\u001b[Jworkingdone')
  })

  it('coalesces multiple complete frames received together', () => {
    const write = vi.fn()
    const output = new SynchronizedOutputWriter(write)

    output.push(`${syncStart}frame-1${syncEnd}${syncStart}frame-2${syncEnd}`)

    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith('frame-1frame-2')
    vi.advanceTimersByTime(500)
    expect(write).toHaveBeenCalledOnce()
  })

  it('fails open when a synchronized frame exceeds the size limit', () => {
    const write = vi.fn()
    const output = new SynchronizedOutputWriter(write, { maxBufferedCharacters: 8 })

    output.push(`${syncStart}123456789`)

    expect(write).toHaveBeenCalledWith('123456789')
    output.push('next')
    expect(write).toHaveBeenLastCalledWith('next')
  })

  it('fails open after the frame timeout and accepts later output', () => {
    const write = vi.fn()
    const output = new SynchronizedOutputWriter(write, { frameTimeoutMs: 100 })
    output.push(`${syncStart}partial`)

    vi.advanceTimersByTime(99)
    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(write).toHaveBeenCalledWith('partial')

    output.push('next')
    expect(write).toHaveBeenLastCalledWith('next')
  })

  it('flushes incomplete markers during disposal only once', () => {
    const write = vi.fn()
    const output = new SynchronizedOutputWriter(write)
    output.push(`${syncStart}partial`)

    output.dispose()
    output.dispose()

    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith('partial')
  })

  it('flushes an incomplete frame without disposing the writer', () => {
    const write = vi.fn()
    const output = new SynchronizedOutputWriter(write)
    output.push(`${syncStart}old frame`)

    output.flush()
    output.push('new output')

    expect(write.mock.calls).toEqual([['old frame'], ['new output']])
  })
})
