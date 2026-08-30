import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { terminalTrace } from '@/lib/terminalTrace'

describe('terminalTrace', () => {
  const originalConsole = console.debug
  let messages: unknown[][]

  beforeEach(() => {
    messages = []
    console.debug = (...args: unknown[]) => {
      messages.push(args)
    }
  })

  afterEach(() => {
    console.debug = originalConsole
    delete window.__msshTrace
  })

  it('logs and forwards trace entries when enabled', () => {
    const received: unknown[] = []
    const unsubscribe = Events.On('terminal:trace', (event: unknown) => {
      received.push(event)
    })
    window.__msshTrace = true
    terminalTrace('input:keypress', { terminalID: 'term-1', len: 1 })

    expect(messages).toHaveLength(1)
    const [tag, timestamp, name, details] = messages[0]
    expect(tag).toBe('[mssh-trace]')
    expect(typeof timestamp).toBe('number')
    expect(name).toBe('input:keypress')
    expect(details).toEqual({ terminalID: 'term-1', len: 1 })

    expect(received).toHaveLength(1)
    const forwarded = received[0] as { data: Record<string, unknown> }
    expect(forwarded.data.name).toBe('input:keypress')
    expect(forwarded.data.terminalID).toBe('term-1')
    expect(typeof forwarded.data.at).toBe('number')
    unsubscribe()
  })

  it('stays silent when disabled', () => {
    terminalTrace('input:keypress', { terminalID: 'term-1', len: 1 })
    expect(messages).toHaveLength(0)
  })

  it('tolerates a missing window', () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    // @ts-expect-error 模拟非浏览器环境
    delete globalThis.window
    expect(() => terminalTrace('input:keypress')).not.toThrow()
    expect(messages).toHaveLength(0)
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
  })
})