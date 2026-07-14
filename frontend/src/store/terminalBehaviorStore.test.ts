import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TERMINAL_BEHAVIOR,
  normalizeCopyOnSelect,
  normalizeTerminalRightClickAction,
  useTerminalBehaviorStore,
} from '@/store/terminalBehaviorStore'

describe('terminal behavior store', () => {
  beforeEach(() => useTerminalBehaviorStore.setState(DEFAULT_TERMINAL_BEHAVIOR))

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

  it('publishes complete settings atomically', () => {
    useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'paste', copyOnSelect: true })
    expect(useTerminalBehaviorStore.getState()).toMatchObject({ rightClickAction: 'paste', copyOnSelect: true })
  })
})
