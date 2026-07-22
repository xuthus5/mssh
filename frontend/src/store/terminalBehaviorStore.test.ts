import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TERMINAL_BEHAVIOR,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  MAX_TERMINAL_SCROLLBACK_LINES,
  MIN_TERMINAL_SCROLLBACK_LINES,
  normalizeCopyOnSelect,
  normalizeScrollbackLines,
  normalizeTerminalRightClickAction,
  useTerminalBehaviorStore,
} from '@/store/terminalBehaviorStore'

describe('terminal behavior store', () => {
  beforeEach(() => useTerminalBehaviorStore.setState({ ...DEFAULT_TERMINAL_BEHAVIOR, settingsHydrated: false }))

  it.each([
    ['menu', 'menu'],
    ['paste', 'paste'],
    ['invalid', 'menu'],
    [null, 'menu'],
  ])('normalizes right-click action %o', (value, expected) => {
    expect(normalizeTerminalRightClickAction(value)).toBe(expected)
  })

  it.each([[true, true], [false, false], ['true', false], [1, false]])('normalizes copy-on-select %o', (value, expected) => {
    expect(normalizeCopyOnSelect(value)).toBe(expected)
  })

  it.each([
    [DEFAULT_TERMINAL_SCROLLBACK_LINES, DEFAULT_TERMINAL_SCROLLBACK_LINES],
    [5000, 5000],
    [MIN_TERMINAL_SCROLLBACK_LINES - 1, MIN_TERMINAL_SCROLLBACK_LINES],
    [MAX_TERMINAL_SCROLLBACK_LINES + 1, MAX_TERMINAL_SCROLLBACK_LINES],
    ['20000', 20000],
    [12.6, MIN_TERMINAL_SCROLLBACK_LINES],
    [Number.NaN, DEFAULT_TERMINAL_SCROLLBACK_LINES],
    [null, DEFAULT_TERMINAL_SCROLLBACK_LINES],
    ['nope', DEFAULT_TERMINAL_SCROLLBACK_LINES],
  ])('normalizes scrollback lines %o', (value, expected) => {
    expect(normalizeScrollbackLines(value)).toBe(expected)
  })

  it('publishes complete settings atomically', () => {
    useTerminalBehaviorStore.getState().setSettings({
      rightClickAction: 'paste',
      copyOnSelect: true,
      scrollbackLines: 5000,
      autoReconnect: true,
      restoreTabsOnStartup: false,
    })
    expect(useTerminalBehaviorStore.getState()).toMatchObject({
      rightClickAction: 'paste',
      copyOnSelect: true,
      scrollbackLines: 5000,
      autoReconnect: true,
      restoreTabsOnStartup: false,
    })
  })

  it('clamps scrollback when publishing settings', () => {
    useTerminalBehaviorStore.getState().setSettings({
      rightClickAction: 'menu',
      copyOnSelect: false,
      scrollbackLines: 999999,
      autoReconnect: false,
      restoreTabsOnStartup: true,
    })
    expect(useTerminalBehaviorStore.getState().scrollbackLines).toBe(MAX_TERMINAL_SCROLLBACK_LINES)
  })
})
