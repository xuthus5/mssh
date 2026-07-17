import { StrictMode, createRef, type ReactNode } from 'react'
import { act, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const terminalOptions: Record<string, unknown>[] = []
const terminalInstances: Array<{ cols: number; rows: number }> = []
const terminalDisposes: Array<ReturnType<typeof vi.fn>> = []
const dataDisposes: Array<ReturnType<typeof vi.fn>> = []
const addonDisposes: Array<ReturnType<typeof vi.fn>> = []
const observerDisconnects: Array<ReturnType<typeof vi.fn>> = []
const outputUnsubscribes: Array<ReturnType<typeof vi.fn>> = []
const themeUnsubscribes: Array<ReturnType<typeof vi.fn>> = []
const selectionDisposes: Array<ReturnType<typeof vi.fn>> = []
const animationFrames: FrameRequestCallback[] = []
const cancelledAnimationFrames: number[] = []
const outputHandlers: Array<(event: { data?: { terminal_id?: string; data?: string } }) => void> = []
const resizeHandlers: ResizeObserverCallback[] = []
let runtimeFailure: 'fit' | 'refresh' | 'focus' | 'write' | null = null

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = {}
    private allowProposedApi = false
    private unicodeApi = { activeVersion: '6' }
    open() { calls.push('open') }
    private addons: Array<{ dispose: () => void }> = []
    loadAddon(addon: { name: string; dispose: () => void }) { calls.push(`load:${addon.name}`); this.addons.push(addon) }
    private terminalDispose = vi.fn(() => calls.push('dispose'))
    constructor(options: Record<string, unknown>) {
      terminalOptions.push(options)
      terminalInstances.push(this)
      terminalDisposes.push(this.terminalDispose)
      this.options = options
      this.allowProposedApi = options.allowProposedApi === true
    }
    get unicode() {
      if (!this.allowProposedApi) throw new Error('you must set the allowProposedApi option to true to use proposed api')
      return this.unicodeApi
    }
    onData() {
      const dispose = vi.fn()
      dataDisposes.push(dispose)
      return { dispose }
    }
    getSelection() { return '' }
    onSelectionChange() {
      const dispose = vi.fn()
      selectionDisposes.push(dispose)
      return { dispose }
    }
    write() { if (runtimeFailure === 'write') throw new Error('write failed') }
    focus() { calls.push('focus'); if (runtimeFailure === 'focus') throw new Error('focus failed') }
    blur() { calls.push('blur') }
    refresh() { calls.push('refresh'); if (runtimeFailure === 'refresh') throw new Error('refresh failed') }
    dispose() { this.addons.forEach((addon) => addon.dispose()); this.terminalDispose() }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    name = 'fit'
    private addonDispose = vi.fn()
    constructor() { addonDisposes.push(this.addonDispose) }
    fit() {
      calls.push('fit')
      if (runtimeFailure === 'fit') throw new Error('fit failed')
    }
    dispose() { this.addonDispose() }
  },
}))

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class {
    name = 'unicode11'
    dispose() { calls.push('dispose:unicode11') }
  },
}))

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: vi.fn((_name: string, handler: (event: { data?: { terminal_id?: string; data?: string } }) => void) => {
      const unsubscribe = vi.fn()
      outputHandlers.push(handler)
      outputUnsubscribes.push(unsubscribe)
      return unsubscribe
    }),
  },
}))

vi.mock('@/lib/wails', () => ({
  TerminalService: { Attach: vi.fn(async () => {}), Resize: vi.fn(async () => {}), Write: vi.fn(async () => {}), Close: vi.fn(async () => {}) },
  CommandHistoryService: { Add: vi.fn(async () => {}) },
}))

import { useTerminal } from '@/hooks/useTerminal'
import { TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { TerminalErrorBoundary } from '@/components/terminal/TerminalErrorBoundary'

describe('useTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    calls.length = 0
    terminalOptions.length = 0
    terminalInstances.length = 0
    terminalDisposes.length = 0
    dataDisposes.length = 0
    addonDisposes.length = 0
    observerDisconnects.length = 0
    outputUnsubscribes.length = 0
    themeUnsubscribes.length = 0
    selectionDisposes.length = 0
    animationFrames.length = 0
    cancelledAnimationFrames.length = 0
    outputHandlers.length = 0
    resizeHandlers.length = 0
    runtimeFailure = null
    useTerminalBehaviorStore.setState({ rightClickAction: 'menu', copyOnSelect: false })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect = vi.fn()
      constructor(callback: ResizeObserverCallback) {
        observerDisconnects.push(this.disconnect)
        resizeHandlers.push(callback)
      }
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

    const { unmount } = renderHook(() => useTerminal('term-1', containerRef, { active: true, focusRequest: { sequence: 0 } }))

    expect(calls).toEqual(['open', 'load:unicode11', 'load:fit'])
    expect(terminalOptions[0]).toEqual(expect.objectContaining({ allowProposedApi: true }))
    expect(selectionDisposes).toHaveLength(1)
    act(() => unmount())
    expect(selectionDisposes[0]).toHaveBeenCalledOnce()
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

    const { unmount } = renderHook(() => useTerminal('term-themed', containerRef, { active: true, focusRequest: { sequence: 0 } }))

    expect(terminalOptions[0]).toEqual(expect.objectContaining({
      fontSize: 18,
      theme: expect.objectContaining({ background: '#ffffff', foreground: '#111111' }),
    }))
    act(() => unmount())
  })

  it('hot-applies a fixed custom background to an open terminal', () => {
    const containerRef = createRef<HTMLDivElement>()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 800 })
    Object.defineProperty(container, 'clientHeight', { value: 500 })
    containerRef.current = container
    const { unmount } = renderHook(() => useTerminal('term-fixed-theme', containerRef, { active: true, focusRequest: { sequence: 0 } }))
    calls.length = 0

    act(() => useAppStore.getState().setTerminalTheme({ ...useAppStore.getState().terminalTheme, background: '#123456', fontFamily: 'Global Font', fontSize: 18, cursorStyle: 'underline' }))

    expect(terminalOptions[0].theme).toEqual(expect.objectContaining({ background: '#123456' }))
    expect(terminalOptions[0]).toEqual(expect.objectContaining({ fontFamily: 'Global Font', fontSize: 18, cursorStyle: 'underline' }))
    expect(calls).toEqual(['fit', 'refresh'])
    expect(TerminalService.Resize).toHaveBeenCalledWith('term-fixed-theme', 80, 24)
    act(() => unmount())
  })

  it('blurs a terminal when its tab becomes inactive', () => {
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')
    const { rerender, unmount } = renderHook(({ active }) => useTerminal('term-focus', containerRef, { active, focusRequest: { sequence: 0 } }), { initialProps: { active: true } })

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
    const { rerender, unmount } = renderHook(({ active, sequence }) => useTerminal('term-resume', containerRef, { active, focusRequest: { sequence } }), { initialProps: { active: false, sequence: 0 } })

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

  it('keeps a zero-size activation pending until the first visible resize', () => {
    let width = 0
    let height = 0
    const containerRef = createRef<HTMLDivElement>()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { get: () => width })
    Object.defineProperty(container, 'clientHeight', { get: () => height })
    containerRef.current = container
    const hook = renderHook(({ active, sequence }) => useTerminal('term-recover', containerRef, { active, focusRequest: { sequence } }), { initialProps: { active: false, sequence: 0 } })

    calls.length = 0
    hook.rerender({ active: true, sequence: 1 })
    act(flushAnimationFrame)
    expect(calls).toEqual([])

    width = 800
    height = 500
    act(() => resizeHandlers[0]([], {} as ResizeObserver))
    expect(calls).toEqual(['fit', 'refresh', 'focus'])

    act(() => resizeHandlers[0]([], {} as ResizeObserver))
    expect(calls.filter((call) => call === 'focus')).toHaveLength(1)
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

    const { unmount } = renderHook(() => useTerminal('term-cleanup', containerRef, { active: true, focusRequest: { sequence: 1 } }), { wrapper })

    act(() => unmount())
    act(() => unmount())

    expect(terminalDisposes.length).toBeGreaterThan(0)
    expect(terminalDisposes.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
    expect(dataDisposes.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
    expect(addonDisposes.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
    expect(observerDisconnects.every((disconnect) => disconnect.mock.calls.length === 1)).toBe(true)
    expect(outputUnsubscribes.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true)
    expect(themeUnsubscribes.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true)
    expect(selectionDisposes.length).toBeGreaterThan(0)
    expect(selectionDisposes.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
    expect(cancelledAnimationFrames.length).toBeGreaterThan(0)
    expect(new Set(cancelledAnimationFrames).size).toBe(cancelledAnimationFrames.length)
  })

  it.each(['fit', 'refresh', 'focus'] as const)('reports %s failures from the activation frame', (failure) => {
    const containerRef = createRef<HTMLDivElement>()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 800 })
    Object.defineProperty(container, 'clientHeight', { value: 500 })
    containerRef.current = container
    const wrapper = ({ children }: { children: ReactNode }) => <TerminalErrorBoundary onClose={vi.fn()}>{children}</TerminalErrorBoundary>
    const hook = renderHook(({ active, sequence }) => useTerminal('term-runtime', containerRef, { active, focusRequest: { sequence } }), { initialProps: { active: false, sequence: 0 }, wrapper })

    runtimeFailure = failure
    hook.rerender({ active: true, sequence: 1 })
    act(flushAnimationFrame)

    expect(screen.getByText('终端渲染失败')).toBeInTheDocument()
  })

  it('reports output write failures from the runtime event callback', () => {
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')
    const wrapper = ({ children }: { children: ReactNode }) => <TerminalErrorBoundary onClose={vi.fn()}>{children}</TerminalErrorBoundary>
    renderHook(() => useTerminal('term-output', containerRef, { active: false, focusRequest: { sequence: 0 } }), { wrapper })

    runtimeFailure = 'write'
    act(() => outputHandlers[0]({ data: { terminal_id: 'term-output', data: 'hello' } }))

    expect(screen.getByText('终端渲染失败')).toBeInTheDocument()
  })

  it('reports fit failures from the resize observer callback', () => {
    const containerRef = createRef<HTMLDivElement>()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 800 })
    Object.defineProperty(container, 'clientHeight', { value: 500 })
    containerRef.current = container
    const wrapper = ({ children }: { children: ReactNode }) => <TerminalErrorBoundary onClose={vi.fn()}>{children}</TerminalErrorBoundary>
    renderHook(() => useTerminal('term-resize', containerRef, { active: true, focusRequest: { sequence: 0 } }), { wrapper })

    runtimeFailure = 'fit'
    act(() => resizeHandlers[0]([], {} as ResizeObserver))

    expect(screen.getByText('终端渲染失败')).toBeInTheDocument()
  })

  it('debounces repeated backend resize notifications', () => {
    vi.useFakeTimers()
    const containerRef = createRef<HTMLDivElement>()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 800 })
    Object.defineProperty(container, 'clientHeight', { value: 500 })
    containerRef.current = container
    const hook = renderHook(() => useTerminal('term-debounce', containerRef, { active: true, focusRequest: { sequence: 0 } }))
    act(flushAnimationFrame)
    act(() => resizeHandlers[0]([], {} as ResizeObserver))
    act(() => vi.advanceTimersByTime(80))
    vi.mocked(TerminalService.Resize).mockClear()
    terminalInstances[0].cols = 100

    act(() => { resizeHandlers[0]([], {} as ResizeObserver); resizeHandlers[0]([], {} as ResizeObserver) })
    expect(TerminalService.Resize).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(80))
    expect(TerminalService.Resize).toHaveBeenCalledOnce()
    act(() => hook.unmount())
    vi.useRealTimers()
  })
})
