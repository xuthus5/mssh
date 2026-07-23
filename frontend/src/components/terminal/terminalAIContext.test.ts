import { describe, expect, it } from 'vitest'
import { captureTerminalContext, clampUTF8Text } from '@/components/terminal/terminalAIContext'

describe('captureTerminalContext', () => {
  it('captures only the configured trailing lines', () => {
    const lines = ['one', 'two', 'three', 'four']
    const terminal = { buffer: { active: { length: lines.length, getLine: (index: number) => ({ translateToString: () => lines[index] }) } } }
    expect(captureTerminalContext(terminal as never, 2)).toBe('three\nfour')
  })

  it('returns an empty context without a terminal', () => {
    expect(captureTerminalContext(undefined, 80)).toBe('')
  })

  it('clamps captured context by UTF-8 byte budget', () => {
    const lines = ['alpha', 'bravo', 'charlie-delta']
    const terminal = { buffer: { active: { length: lines.length, getLine: (index: number) => ({ translateToString: () => lines[index] }) } } }
    const full = captureTerminalContext(terminal as never, 10)
    const limited = captureTerminalContext(terminal as never, 10, 8)
    expect(full).toContain('alpha')
    expect(new TextEncoder().encode(limited).length).toBeLessThanOrEqual(8)
    expect(limited.length).toBeGreaterThan(0)
  })
})

describe('clampUTF8Text', () => {
  it('keeps multi-byte characters intact when truncating', () => {
    const value = '你好世界'
    const clamped = clampUTF8Text(value, 6)
    expect(new TextEncoder().encode(clamped).length).toBeLessThanOrEqual(6)
    expect(clamped).toBe('世界')
  })

  it('returns original text when under budget', () => {
    expect(clampUTF8Text('abc', 10)).toBe('abc')
    expect(clampUTF8Text('abc', 0)).toBe('abc')
  })
})
