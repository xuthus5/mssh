import { describe, expect, it } from 'vitest'
import { captureTerminalContext } from '@/components/terminal/terminalAIContext'

describe('captureTerminalContext', () => {
  it('captures only the configured trailing lines', () => {
    const lines = ['one', 'two', 'three', 'four']
    const terminal = { buffer: { active: { length: lines.length, getLine: (index: number) => ({ translateToString: () => lines[index] }) } } }
    expect(captureTerminalContext(terminal as never, 2)).toBe('three\nfour')
  })

  it('returns an empty context without a terminal', () => {
    expect(captureTerminalContext(undefined, 80)).toBe('')
  })
})
