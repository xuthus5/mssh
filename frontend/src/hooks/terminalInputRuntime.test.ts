import { describe, expect, it, vi } from 'vitest'
import { createTerminalInputBatcher, resolveSessionId, subscribeToTerminalData, TERMINAL_INPUT_BATCH_DELAY_MS, TERMINAL_INPUT_BATCH_MAX_LENGTH } from '@/hooks/terminalInputRuntime'
import { TerminalCommandCapture } from '@/lib/terminalCommandCapture'
import { readCommandHistory } from '@/lib/commandHistory'

describe('terminalInputRuntime', () => {
  it('coalesces rapid input and preserves order', async () => {
    vi.useFakeTimers()
    const send = vi.fn(() => Promise.resolve())
    const batcher = createTerminalInputBatcher(send)

    batcher.write('a')
    batcher.write('b')
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_BATCH_DELAY_MS)

    expect(send).toHaveBeenCalledWith('ab')
    batcher.dispose()
    vi.useRealTimers()
  })

  it('flushes control input immediately and flushes pending data on dispose', async () => {
    vi.useFakeTimers()
    const send = vi.fn(() => Promise.resolve())
    const batcher = createTerminalInputBatcher(send)

    batcher.write('ls')
    batcher.write('\r')
    await vi.runAllTimersAsync()
    expect(send).toHaveBeenCalledWith('ls\r')

    batcher.write('next')
    batcher.dispose()
    await vi.runAllTimersAsync()
    expect(send).toHaveBeenLastCalledWith('next')
    vi.useRealTimers()
  })

  it('ignores empty input and flushes oversized batches without waiting', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const batcher = createTerminalInputBatcher(send)

    batcher.write('')
    expect(send).not.toHaveBeenCalled()
    batcher.write('x'.repeat(TERMINAL_INPUT_BATCH_MAX_LENGTH))

    expect(send).toHaveBeenCalledWith('x'.repeat(TERMINAL_INPUT_BATCH_MAX_LENGTH))
    vi.useRealTimers()
  })

  it('does not throw when the transport callback fails synchronously', () => {
    const batcher = createTerminalInputBatcher(() => { throw new Error('transport failed') })

    expect(() => batcher.write('\u0003')).not.toThrow()
  })

  it('resolves session id from terminal tab', () => {
    const refs = {
      terminalIDRef: { current: 'term-1' },
      storeRef: {
        current: {
          tabs: [{ type: 'terminal', terminalId: 'term-1', sessionId: 9 }],
          updateLastUsed: vi.fn(),
        },
      },
    }
    expect(resolveSessionId(refs as never)).toBe(9)
  })

  it('resolves the owning session for a secondary split pane', () => {
    const refs = {
      terminalIDRef: { current: 'term-secondary' },
      storeRef: {
        current: {
          tabs: [{
            type: 'terminal', terminalId: 'term-primary', splitPaneIDs: ['term-primary', 'term-secondary'], sessionId: 9,
          }],
          updateLastUsed: vi.fn(),
        },
      },
    }
    expect(resolveSessionId(refs as never)).toBe(9)
  })

  it('uses negative serial port ids for serial history buckets', () => {
    const refs = {
      terminalIDRef: { current: 'term-s' },
      storeRef: {
        current: {
          tabs: [{ type: 'terminal', terminalId: 'term-s', sessionId: 0, connectionKind: 'serial', serialPortId: 12 }],
          updateLastUsed: vi.fn(),
        },
      },
    }
    expect(resolveSessionId(refs as never)).toBe(-12)
  })

  it('uses per-instance buckets for local shell history', () => {
    const refs = {
      terminalIDRef: { current: 'term-l' },
      storeRef: {
        current: {
          tabs: [{ type: 'terminal', terminalId: 'term-l', sessionId: 0, connectionKind: 'local', terminalInstance: 2 }],
          updateLastUsed: vi.fn(),
        },
      },
    }
    expect(resolveSessionId(refs as never)).toBe(-(2_000_000 + 2))
  })

  it('records submitted commands while writing input', () => {
    localStorage.clear()
    const write = vi.fn()
    const updateLastUsed = vi.fn()
    let handler: ((data: string) => void) | undefined
    const term = {
      onData: (cb: (data: string) => void) => {
        handler = cb
        return { dispose: vi.fn() }
      },
    }
    const refs = {
      terminalIDRef: { current: 'term-1' },
      storeRef: {
        current: {
          tabs: [{ type: 'terminal', terminalId: 'term-1', sessionId: 3 }],
          updateLastUsed,
        },
      },
    }
    subscribeToTerminalData(term as never, refs as never, new TerminalCommandCapture(), write)
    handler?.('echo hi\r')
    expect(write).toHaveBeenCalledWith('echo hi\r')
    expect(updateLastUsed).toHaveBeenCalledWith('term-1')
    expect(readCommandHistory(3)[0]?.command).toBe('echo hi')
  })

  it('records commands entered in a secondary split pane', () => {
    localStorage.clear()
    let handler: ((data: string) => void) | undefined
    const refs = {
      terminalIDRef: { current: 'term-secondary' },
      storeRef: {
        current: {
          tabs: [{
            type: 'terminal', terminalId: 'term-primary', splitPaneIDs: ['term-primary', 'term-secondary'], sessionId: 7,
          }],
          updateLastUsed: vi.fn(),
        },
      },
    }
    subscribeToTerminalData({
      onData: (callback: (data: string) => void) => {
        handler = callback
        return { dispose: vi.fn() }
      },
    } as never, refs as never, new TerminalCommandCapture(), vi.fn())

    handler?.('tail -f app.log\r')

    expect(readCommandHistory(7)[0]?.command).toBe('tail -f app.log')
  })
})
