import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalOutputTransformRuntime,
  TERMINAL_OUTPUT_TRANSFORM_IDLE_FLUSH_MS,
} from '@/hooks/terminalOutputTransformRuntime'

function bytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0))
}

describe('createTerminalOutputTransformRuntime', () => {
  it('emits transformed bytes and releases pending bytes after idle', () => {
    let scheduled: (() => void) | undefined
    const emit = vi.fn()
    const schedule = vi.fn((callback: () => void, delayMs: number) => {
      expect(delayMs).toBe(TERMINAL_OUTPUT_TRANSFORM_IDLE_FLUSH_MS)
      scheduled = callback
      return 7
    })
    const runtime = createTerminalOutputTransformRuntime({
      transform: (data) => data.slice(0, 1),
      flush: () => bytes('tail'),
      emit,
      schedule,
    })

    expect(runtime.transform(bytes('input'))).toEqual(bytes('i'))
    expect(schedule).toHaveBeenCalledOnce()
    expect(emit).not.toHaveBeenCalled()
    scheduled?.()
    expect(emit).toHaveBeenCalledWith(bytes('tail'))
  })

  it('flushes immediately and cancels a scheduled idle callback', () => {
    const cancel = vi.fn()
    const emit = vi.fn()
    let flushCount = 0
    const runtime = createTerminalOutputTransformRuntime({
      transform: (data) => data,
      flush: () => {
        flushCount += 1
        return flushCount === 1 ? bytes('pending') : new Uint8Array(0)
      },
      emit,
      schedule: () => 11,
      cancel,
    })

    runtime.transform(bytes('value'))
    runtime.flush()
    runtime.flush()
    expect(cancel).toHaveBeenCalledWith(11)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(bytes('pending'))
  })

  it('skips idle scheduling when no pending output exists', () => {
    const schedule = vi.fn(() => 1)
    const cancel = vi.fn()
    const runtime = createTerminalOutputTransformRuntime({
      transform: (data) => data,
      flush: () => new Uint8Array(0),
      emit: vi.fn(),
      shouldSchedule: () => false,
      schedule,
      cancel,
    })

    expect(runtime.transform(bytes('value'))).toEqual(bytes('value'))
    expect(schedule).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('reports flush errors and stops scheduling after disposal', () => {
    const report = vi.fn()
    const schedule = vi.fn((callback: () => void) => {
      callback()
      return 3
    })
    const runtime = createTerminalOutputTransformRuntime({
      transform: (data) => data,
      flush: () => { throw new Error('flush failed') },
      emit: vi.fn(),
      schedule,
      onError: report,
    })

    runtime.transform(bytes('value'))
    expect(report).toHaveBeenCalledWith(expect.any(Error))
    runtime.dispose()
    expect(runtime.transform(bytes('after'))).toEqual(bytes('after'))
  })

  it('clamps a negative idle delay to zero', () => {
    const schedule = vi.fn((_callback: () => void, delayMs: number) => {
      expect(delayMs).toBe(0)
      return 1
    })
    const runtime = createTerminalOutputTransformRuntime({
      transform: (data) => data,
      flush: () => new Uint8Array(0),
      emit: vi.fn(),
      idleFlushMs: -1,
      schedule,
    })

    runtime.transform(bytes('value'))
    expect(schedule).toHaveBeenCalledOnce()
  })
})
