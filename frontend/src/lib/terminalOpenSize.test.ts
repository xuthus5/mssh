import { beforeEach, describe, expect, it } from 'vitest'
import { resolveOpenTerminalSize } from '@/lib/terminalOpenSize'
import { useAppStore } from '@/store/appStore'

describe('resolveOpenTerminalSize', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [],
      terminalPool: new Map(),
      activePaneId: null,
      activeSurface: null,
    } as never)
  })

  it('falls back to 80x24 without an active terminal', () => {
    expect(resolveOpenTerminalSize()).toEqual({ cols: 80, rows: 24 })
  })

  it('prefers the explicit terminal size', () => {
    useAppStore.setState({
      terminalPool: new Map([
        ['term-a', { terminal: { cols: 120, rows: 40 }, lastUsed: 1 }],
        ['term-b', { terminal: { cols: 90, rows: 30 }, lastUsed: 2 }],
      ]),
      activePaneId: 'term-b',
    } as never)
    expect(resolveOpenTerminalSize('term-a')).toEqual({ cols: 120, rows: 40 })
  })

  it('uses the active pane when no preferred id is provided', () => {
    useAppStore.setState({
      terminalPool: new Map([
        ['term-b', { terminal: { cols: 100, rows: 36 }, lastUsed: 2 }],
      ]),
      activePaneId: 'term-b',
    } as never)
    expect(resolveOpenTerminalSize()).toEqual({ cols: 100, rows: 36 })
  })
})
