import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'

const calls: string[] = []
const terminalOptions: Record<string, unknown>[] = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = {}
    constructor(options: Record<string, unknown>) { terminalOptions.push(options); this.options = options }
    open() { calls.push('open') }
    loadAddon(addon: { name: string }) { calls.push(`load:${addon.name}`) }
    onData() { return { dispose: vi.fn() } }
    write() {}
    focus() {}
    blur() { calls.push('blur') }
    refresh() { calls.push('refresh') }
    dispose() { calls.push('dispose') }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { name = 'fit'; fit() { calls.push('fit') } },
}))

vi.mock('@/lib/wails', () => ({
  TerminalService: { Resize: vi.fn(async () => {}), Write: vi.fn(async () => {}), Close: vi.fn(async () => {}) },
}))

import { useTerminal } from '@/hooks/useTerminal'
import { useAppStore } from '@/store/appStore'

describe('useTerminal', () => {
  beforeEach(() => {
    calls.length = 0
    terminalOptions.length = 0
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  it('opens the terminal before loading renderer addons', () => {
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')

    const { unmount } = renderHook(() => useTerminal('term-1', containerRef, true))

    expect(calls).toEqual(['open', 'load:fit'])
    act(() => unmount())
    expect(calls.at(-1)).toBe('dispose')
  })

  it('uses the restored global theme for the first terminal instance', () => {
    useAppStore.getState().setTerminalTheme({
      ...useAppStore.getState().terminalTheme,
      background: '#ffffff',
      foreground: '#111111',
      fontSize: 18,
    })
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')

    const { unmount } = renderHook(() => useTerminal('term-themed', containerRef, true))

    expect(terminalOptions[0]).toEqual(expect.objectContaining({
      fontSize: 18,
      theme: expect.objectContaining({ background: '#ffffff', foreground: '#111111' }),
    }))
    act(() => unmount())
  })

  it('blurs a terminal when its tab becomes inactive', () => {
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')
    const { rerender, unmount } = renderHook(({ active }) => useTerminal('term-focus', containerRef, active), { initialProps: { active: true } })

    rerender({ active: false })

    expect(calls).toContain('blur')
    act(() => unmount())
  })

  it('refits and refreshes after an inactive terminal becomes visible', () => {
    const containerRef = createRef<HTMLDivElement>()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 800 })
    Object.defineProperty(container, 'clientHeight', { value: 500 })
    containerRef.current = container
    const { rerender, unmount } = renderHook(({ active }) => useTerminal('term-resume', containerRef, active), { initialProps: { active: false } })

    calls.length = 0
    rerender({ active: true })

    expect(calls).toContain('fit')
    expect(calls).toContain('refresh')
    act(() => unmount())
  })
})
