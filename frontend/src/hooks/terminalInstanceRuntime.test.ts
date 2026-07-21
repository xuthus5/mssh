import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TERMINAL_BEHAVIOR,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  MAX_TERMINAL_SCROLLBACK_LINES,
  useTerminalBehaviorStore,
} from '@/store/terminalBehaviorStore'
import {
  applyTerminalScrollback,
  createTerminalInstance,
} from '@/hooks/terminalInstanceRuntime'

const constructed: Array<Record<string, unknown>> = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>
    constructor(options: Record<string, unknown>) {
      constructed.push(options)
      this.options = { ...options }
    }
  },
}))

vi.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: class {},
}))

describe('terminalInstanceRuntime scrollback', () => {
  beforeEach(() => {
    constructed.length = 0
    useTerminalBehaviorStore.setState(DEFAULT_TERMINAL_BEHAVIOR)
  })

  it('creates terminals with the default scrollback', () => {
    createTerminalInstance()
    expect(constructed[0]?.scrollback).toBe(DEFAULT_TERMINAL_SCROLLBACK_LINES)
  })

  it('creates terminals with the configured scrollback', () => {
    useTerminalBehaviorStore.setState({ ...DEFAULT_TERMINAL_BEHAVIOR, scrollbackLines: 5000 })
    createTerminalInstance()
    expect(constructed[0]?.scrollback).toBe(5000)
  })

  it('applies live scrollback updates and clamps values', () => {
    const term = createTerminalInstance()
    applyTerminalScrollback(term, 2500)
    expect(term.options.scrollback).toBe(2500)
    applyTerminalScrollback(term, 999999)
    expect(term.options.scrollback).toBe(MAX_TERMINAL_SCROLLBACK_LINES)
  })
})
