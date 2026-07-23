import { describe, expect, it } from 'vitest'
import { isTerminalGone } from '@/lib/terminalGone'

describe('isTerminalGone', () => {
  it('detects terminal-not-found style errors', () => {
    expect(isTerminalGone(new Error('terminal term-1 not found'))).toBe(true)
    expect(isTerminalGone('serial port not available')).toBe(true)
    expect(isTerminalGone(new Error('connection refused'))).toBe(false)
  })
})
