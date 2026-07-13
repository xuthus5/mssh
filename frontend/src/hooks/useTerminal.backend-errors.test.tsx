import { createRef, type ReactNode } from 'react'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({
  resize: vi.fn(async () => {}),
  write: vi.fn(async () => 0),
}))
const dataHandlers: Array<(data: string) => void> = []
const dataDisposes: Array<ReturnType<typeof vi.fn>> = []
const terminalDisposes: Array<ReturnType<typeof vi.fn>> = []
const terminalOptions: Record<string, unknown>[] = []
const animationFrames: FrameRequestCallback[] = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown>
    private addons: Array<{ dispose: () => void }> = []
    private terminalDispose = vi.fn()
    constructor(options: Record<string, unknown>) {
      this.options = options
      terminalOptions.push(options)
      terminalDisposes.push(this.terminalDispose)
    }
    open() {}
    loadAddon(addon: { dispose: () => void }) { this.addons.push(addon) }
    onData(handler: (data: string) => void) {
      const dispose = vi.fn()
      dataHandlers.push(handler)
      dataDisposes.push(dispose)
      return { dispose }
    }
    write() {}
    focus() {}
    blur() {}
    refresh() {}
    dispose() { this.addons.forEach((addon) => addon.dispose()); this.terminalDispose() }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {}; dispose() {} } }))
vi.mock('@wailsio/runtime', () => ({ Events: { On: vi.fn(() => vi.fn()) } }))
vi.mock('@/lib/wails', () => ({
  TerminalService: { Resize: backend.resize, Write: backend.write, Close: vi.fn(async () => {}) },
}))

import { useTerminal } from '@/hooks/useTerminal'
import { useAppStore } from '@/store/appStore'
import { TerminalErrorBoundary } from '@/components/terminal/TerminalErrorBoundary'
import { logger } from '@/lib/logger'
import { ToastContainer, useToastStore } from '@/components/ui/toast'

function boundary({ children }: { children: ReactNode }) {
  return <TerminalErrorBoundary onClose={vi.fn()}>{children}</TerminalErrorBoundary>
}

function visibleContainer() {
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { value: 800 })
  Object.defineProperty(container, 'clientHeight', { value: 500 })
  return container
}

describe('useTerminal backend failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dataHandlers.length = 0
    dataDisposes.length = 0
    terminalDisposes.length = 0
    terminalOptions.length = 0
    animationFrames.length = 0
    backend.resize.mockResolvedValue(undefined)
    backend.write.mockResolvedValue(0)
    useToastStore.setState({ toasts: [] })
    useAppStore.setState({ terminalPool: new Map(), connectionStatus: {} })
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  it('disconnects and reports only the first rejected write', async () => {
    const error = new Error('write failed')
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    backend.write.mockRejectedValue(error)
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')
    const wrapper = ({ children }: { children: ReactNode }) => <>{boundary({ children })}<ToastContainer /></>
    renderHook(() => useTerminal('term-write', containerRef, { active: false, focusRequest: { sequence: 0 } }), { wrapper })

    act(() => { dataHandlers[0]('first'); dataHandlers[0]('second') })

    await waitFor(() => expect(useAppStore.getState().connectionStatus['term-write']).toBe('disconnected'))
    expect(screen.queryByText('终端渲染失败')).not.toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(terminalDisposes[0]).not.toHaveBeenCalled()
    expect(loggerError).toHaveBeenCalledTimes(1)
  })

  it('keeps a synchronous write failure outside the boundary', async () => {
    backend.write.mockImplementationOnce(() => { throw new Error('write threw') })
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')
    renderHook(() => useTerminal('term-write-sync', containerRef, { active: false, focusRequest: { sequence: 0 } }), { wrapper: boundary })

    act(() => dataHandlers[0]('input'))

    await waitFor(() => expect(useAppStore.getState().connectionStatus['term-write-sync']).toBe('disconnected'))
    expect(screen.queryByText('终端渲染失败')).not.toBeInTheDocument()
  })

  it.each([
    ['rejected', (error: Error) => backend.resize.mockRejectedValueOnce(error)],
    ['synchronous', (error: Error) => backend.resize.mockImplementationOnce(() => { throw error })],
  ])('logs %s resize errors without entering the boundary', async (_mode, failResize) => {
    const error = new Error('resize failed')
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    failResize(error)
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = visibleContainer()
    renderHook(() => useTerminal('term-resize', containerRef, { active: true, focusRequest: { sequence: 0 } }), { wrapper: boundary })

    act(() => animationFrames.shift()?.(0))

    await waitFor(() => expect(loggerError).toHaveBeenCalledWith('terminal activation resize error', error))
    expect(screen.queryByText('终端渲染失败')).not.toBeInTheDocument()
  })

  it('hot-applies theme changes to an open terminal', () => {
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')
    const hook = renderHook(() => useTerminal('term-theme', containerRef, { active: false, focusRequest: { sequence: 0 } }))

    act(() => useAppStore.getState().setTerminalTheme({
      ...useAppStore.getState().terminalTheme,
      fontSize: 21,
      background: '#123456',
    }))

    expect(terminalOptions[0]).toMatchObject({ fontSize: 21, theme: expect.objectContaining({ background: '#123456' }) })
    hook.unmount()
  })

  it('logs cleanup failures and disposes the terminal', () => {
    const error = new Error('dispose failed')
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const containerRef = createRef<HTMLDivElement>()
    containerRef.current = document.createElement('div')
    const hook = renderHook(() => useTerminal('term-cleanup', containerRef, { active: false, focusRequest: { sequence: 0 } }))
    dataDisposes[0].mockImplementationOnce(() => { throw error })

    hook.unmount()

    expect(loggerError).toHaveBeenCalledWith('terminal data subscription cleanup error', error)
    expect(terminalDisposes[0]).toHaveBeenCalledOnce()
  })
})
