import { StrictMode, createRef, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const terminalOptions: Record<string, unknown>[] = []
const terminalDisposes: Array<ReturnType<typeof vi.fn>> = []
const dataDisposes: Array<ReturnType<typeof vi.fn>> = []
const addonDisposes: Array<ReturnType<typeof vi.fn>> = []
const observerDisconnects: Array<ReturnType<typeof vi.fn>> = []
const outputUnsubscribes: Array<ReturnType<typeof vi.fn>> = []
const themeUnsubscribes: Array<ReturnType<typeof vi.fn>> = []
const animationFrames: FrameRequestCallback[] = []
const cancelledAnimationFrames: number[] = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = {}
    open() { calls.push('open') }
    loadAddon(addon: { name: string }) { calls.push(`load:${addon.name}`) }
    private terminalDispose = vi.fn(() => calls.push('dispose'))
    constructor(options: Record<string, unknown>) {
      terminalOptions.push(options)
      terminalDisposes.push(this.terminalDispose)
      this.options = options
    }
    onData() {
      const dispose = vi.fn()
      dataDisposes.push(dispose)
      return { dispose }
    }
    write() {}
    focus() { calls.push('focus') }
    blur() { calls.push('blur') }
    refresh() { calls.push('refresh') }
    dispose() { this.terminalDispose() }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    name = 'fit'
    private addonDispose = vi.fn()
    constructor() { addonDisposes.push(this.addonDispose) }
    fit() { calls.push('fit') }
    dispose() { this.addonDispose() }
  },
}))

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: vi.fn(() => {
      const unsubscribe = vi.fn()
      outputUnsubscribes.push(unsubscribe)
      return unsubscribe
    }),
  },
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
    terminalDisposes.length = 0
    dataDisposes.length = 0
    addonDisposes.length = 0
    observerDisconnects.length = 0
    outputUnsubscribes.length = 0
    themeUnsubscribes.length = 0
    animationFrames.length = 0
    cancelledAnimationFrames.length = 0
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect = vi.fn()
      constructor() { observerDisconnects.push(this.disconnect) }
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    })
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => { cancelledAnimationFrames.push(frame) })
  })

  const flushAnimationFrame = () => {
    const callback = animationFrames.shift()
    if (callback) callback(0)
  }

  it('opens the terminal before loading renderer addons', () => {
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')

    const { unmount } = renderHook(() => useTerminal('term-1', containerRef, {
      active: true,
      focusRequest: { sequence: 0 },
    }))

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

    const { unmount } = renderHook(() => useTerminal('term-themed', containerRef, {
      active: true,
      focusRequest: { sequence: 0 },
    }))

    expect(terminalOptions[0]).toEqual(expect.objectContaining({
      fontSize: 18,
      theme: expect.objectContaining({ background: '#ffffff', foreground: '#111111' }),
    }))
    act(() => unmount())
  })

  it('blurs a terminal when its tab becomes inactive', () => {
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')
    const { rerender, unmount } = renderHook(({ active }) => useTerminal('term-focus', containerRef, {
      active,
      focusRequest: { sequence: 0 },
    }), { initialProps: { active: true } })

    rerender({ active: false })

    expect(calls).toContain('blur')
    act(() => unmount())
  })

  it('orders activation recovery and only focuses new requests', () => {
    const containerRef = createRef<HTMLDivElement>()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 800 })
    Object.defineProperty(container, 'clientHeight', { value: 500 })
    containerRef.current = container
    const { rerender, unmount } = renderHook(({ active, sequence }) => useTerminal('term-resume', containerRef, {
      active,
      focusRequest: { sequence },
    }), { initialProps: { active: false, sequence: 0 } })

    calls.length = 0
    rerender({ active: true, sequence: 1 })
    act(flushAnimationFrame)

    expect(calls).toEqual(['fit', 'refresh', 'focus'])

    rerender({ active: false, sequence: 1 })
    calls.length = 0
    rerender({ active: true, sequence: 1 })
    act(flushAnimationFrame)

    expect(calls).toEqual(['fit', 'refresh'])
    act(() => unmount())
  })

  it('disposes every effect resource once under StrictMode cleanup', () => {
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    vi.spyOn(useAppStore, 'subscribe').mockImplementation(() => {
      const unsubscribe = vi.fn()
      themeUnsubscribes.push(unsubscribe)
      return unsubscribe
    })

    const { unmount } = renderHook(() => useTerminal('term-cleanup', containerRef, {
      active: true,
      focusRequest: { sequence: 1 },
    }), { wrapper })

    act(() => unmount())
    act(() => unmount())

    expect(terminalDisposes.length).toBeGreaterThan(0)
    expect(terminalDisposes.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
    expect(dataDisposes.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
    expect(addonDisposes.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
    expect(observerDisconnects.every((disconnect) => disconnect.mock.calls.length === 1)).toBe(true)
    expect(outputUnsubscribes.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true)
    expect(themeUnsubscribes.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true)
    expect(cancelledAnimationFrames.length).toBeGreaterThan(0)
    expect(new Set(cancelledAnimationFrames).size).toBe(cancelledAnimationFrames.length)
  })
})
