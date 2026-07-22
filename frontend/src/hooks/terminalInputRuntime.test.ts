import { describe, expect, it, vi } from 'vitest'
import { resolveSessionId, subscribeToTerminalData } from '@/hooks/terminalInputRuntime'
import { TerminalCommandCapture } from '@/lib/terminalCommandCapture'
import { readCommandHistory } from '@/lib/commandHistory'

describe('terminalInputRuntime', () => {
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

  it('uses fixed bucket for local shell history', () => {
    const refs = {
      terminalIDRef: { current: 'term-l' },
      storeRef: {
        current: {
          tabs: [{ type: 'terminal', terminalId: 'term-l', sessionId: 0, connectionKind: 'local' }],
          updateLastUsed: vi.fn(),
        },
      },
    }
    expect(resolveSessionId(refs as never)).toBe(-1)
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
})
