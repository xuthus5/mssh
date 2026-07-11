import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'

const calls: string[] = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = {}
    open() { calls.push('open') }
    loadAddon(addon: { name: string }) { calls.push(`load:${addon.name}`) }
    onData() { return { dispose: vi.fn() } }
    write() {}
    focus() {}
    dispose() { calls.push('dispose') }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { name = 'fit'; fit() {} },
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class { name = 'webgl' },
}))

vi.mock('@/lib/wails', () => ({
  TerminalService: { Resize: vi.fn(async () => {}), Write: vi.fn(async () => {}), Close: vi.fn(async () => {}) },
}))

import { useTerminal } from '@/hooks/useTerminal'

describe('useTerminal', () => {
  beforeEach(() => {
    calls.length = 0
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
  })

  it('opens the terminal before loading renderer addons', () => {
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')

    const { unmount } = renderHook(() => useTerminal('term-1', containerRef))

    expect(calls.slice(0, 3)).toEqual(['open', 'load:fit', 'load:webgl'])
    act(() => unmount())
    expect(calls.at(-1)).toBe('dispose')
  })
})
