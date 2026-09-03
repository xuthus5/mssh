import { createRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalKeywordHighlightController } from '@/hooks/useTerminalKeywordHighlight'
import { useTerminalKeywordHighlightStore } from '@/store/terminalKeywordHighlightStore'

const handlers: Array<(event: { data?: { terminal_id?: string; sequence?: number; data?: string } }) => void> = []

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: vi.fn((_name: string, handler: (event: { data?: { terminal_id?: string; sequence?: number; data?: string } }) => void) => {
      handlers.push(handler)
      return vi.fn()
    }),
  },
}))

import { subscribeToTerminalOutput } from '@/hooks/terminalOutputRuntime'

function encodeBytes(data: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < data.length; offset += 8192) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}

function writtenText(writes: Uint8Array[]): string {
  const total = writes.reduce((sum, data) => sum + data.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const data of writes) {
    merged.set(data, offset)
    offset += data.length
  }
  return new TextDecoder().decode(merged)
}

describe('subscribeToTerminalOutput flow control', () => {
  beforeEach(() => {
    handlers.length = 0
    useTerminalKeywordHighlightStore.getState().resetToDefault()
  })

  afterEach(() => { vi.useRealTimers() })

  it('pauses the backend before xterm write backlog grows and resumes after parsing', async () => {
    const writes: Uint8Array[] = []
    const callbacks: Array<() => void> = []
    const terminal = {
      write: vi.fn((data: Uint8Array, callback?: () => void) => {
        writes.push(data)
        if (callback) callbacks.push(callback)
      }),
    } as unknown as Terminal
    const terminalIDRef = createRef<string>()
    terminalIDRef.current = 'term-flow'
    const setOutputPaused = vi.fn(async (_terminalID: string, _paused: boolean) => {})
    const subscription = subscribeToTerminalOutput({
      term: terminal,
      terminalIDRef,
      reportRuntimeError: vi.fn(),
      setOutputPaused,
      shouldCoalesce: () => false,
    })

    const first = new Uint8Array(200 * 1024).fill(65)
    const second = new Uint8Array(100 * 1024).fill(66)
    handlers[0]({ data: { terminal_id: 'term-flow', data: encodeBytes(first) } })
    handlers[0]({ data: { terminal_id: 'term-flow', data: encodeBytes(second) } })
    await Promise.resolve()
    expect(writes).toHaveLength(1)
    expect(setOutputPaused).toHaveBeenCalledWith('term-flow', true)

    callbacks.shift()?.()
    callbacks.shift()?.()
    await Promise.resolve()
    expect(writes).toHaveLength(2)
    expect(setOutputPaused).toHaveBeenLastCalledWith('term-flow', false)
    expect(writes[0].length + writes[1].length).toBe(first.length + second.length)
    subscription.dispose()
  })

  it('continues rendering when every backend resume attempt is unavailable', async () => {
    const callbacks: Array<() => void> = []
    const terminal = {
      write: vi.fn((_data: Uint8Array, callback?: () => void) => {
        if (callback) callbacks.push(callback)
      }),
    } as unknown as Terminal
    const terminalIDRef = createRef<string>()
    terminalIDRef.current = 'term-fail-safe'
    const reportRuntimeError = vi.fn()
    const setOutputPaused = vi.fn(async (_terminalID: string, paused: boolean) => {
      if (!paused) throw new Error('resume unavailable')
    })
    const subscription = subscribeToTerminalOutput({
      term: terminal,
      terminalIDRef,
      reportRuntimeError,
      setOutputPaused,
      shouldCoalesce: () => false,
    })

    handlers[0]({ data: { terminal_id: 'term-fail-safe', data: encodeBytes(new Uint8Array(200 * 1024)) } })
    handlers[0]({ data: { terminal_id: 'term-fail-safe', data: encodeBytes(new Uint8Array(100 * 1024)) } })
    await Promise.resolve()
    callbacks.shift()?.()
    callbacks.shift()?.()
    for (let attempt = 0; attempt < 8; attempt++) await Promise.resolve()

    expect(reportRuntimeError).toHaveBeenCalledWith(expect.any(Error), 'terminal output flow control')
    const writesBeforeFailure = vi.mocked(terminal.write).mock.calls.length
    handlers[0]({ data: { terminal_id: 'term-fail-safe', data: encodeBytes(new Uint8Array([1])) } })
    expect(terminal.write).toHaveBeenCalledTimes(writesBeforeFailure + 1)
    subscription.dispose()
  })

  it('flushes a trailing keyword prefix after output becomes idle', () => {
    vi.useFakeTimers()
    const writes: Uint8Array[] = []
    const terminal = {
      write: vi.fn((data: Uint8Array) => { writes.push(new Uint8Array(data)) }),
    } as unknown as Terminal
    const terminalIDRef = createRef<string>()
    terminalIDRef.current = 'term-keyword-idle'
    const highlight = createTerminalKeywordHighlightController({ reportRuntimeError: vi.fn() })
    const subscription = subscribeToTerminalOutput({
      term: terminal,
      terminalIDRef,
      reportRuntimeError: vi.fn(),
      shouldCoalesce: () => false,
      outputTransform: highlight.transform,
      outputFlush: highlight.flush,
      shouldScheduleOutputFlush: highlight.hasPending,
    })

    handlers[0]({ data: { terminal_id: 'term-keyword-idle', data: encodeBytes(new TextEncoder().encode('prompt$ cmd In')) } })
    expect(writtenText(writes)).toBe('prompt$ cmd ')

    vi.advanceTimersByTime(32)
    expect(writtenText(writes)).toBe('prompt$ cmd In')
    subscription.dispose()
    highlight.dispose()
  })

  it('applies stateful output transforms only after restoring event sequence', () => {
    const writes: Uint8Array[] = []
    const terminal = {
      write: vi.fn((data: Uint8Array) => { writes.push(new Uint8Array(data)) }),
    } as unknown as Terminal
    const terminalIDRef = createRef<string>()
    terminalIDRef.current = 'term-keyword-order'
    const highlight = createTerminalKeywordHighlightController({ reportRuntimeError: vi.fn() })
    const subscription = subscribeToTerminalOutput({
      term: terminal,
      terminalIDRef,
      reportRuntimeError: vi.fn(),
      shouldCoalesce: () => false,
      outputTransform: highlight.transform,
      outputFlush: highlight.flush,
      shouldScheduleOutputFlush: highlight.hasPending,
    })

    handlers[0]({ data: { terminal_id: 'term-keyword-order', sequence: 2, data: encodeBytes(new TextEncoder().encode('\u001b[D')) } })
    handlers[0]({ data: { terminal_id: 'term-keyword-order', sequence: 1, data: encodeBytes(new TextEncoder().encode('cmd In')) } })

    expect(writtenText(writes)).toBe('cmd In\u001b[D')
    subscription.dispose()
    highlight.dispose()
  })
})
