import { describe, expect, it, vi } from 'vitest'
import { emitTerminalSearchToggle, TERMINAL_SEARCH_TOGGLE_EVENT } from '@/lib/terminalSearchEvents'

describe('terminalSearchEvents', () => {
  it('emits the terminal search toggle event on window', () => {
    const spy = vi.fn()
    window.addEventListener(TERMINAL_SEARCH_TOGGLE_EVENT, spy)
    emitTerminalSearchToggle()
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener(TERMINAL_SEARCH_TOGGLE_EVENT, spy)
  })
})
