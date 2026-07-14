import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const terminalInstances: Array<{ focus: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = []
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = {}
    focus = vi.fn()
    blur = vi.fn()
    refresh = vi.fn()
    dispose = vi.fn()
    constructor() { terminalInstances.push(this) }
    open() {}
    loadAddon() {}
    onData() { return { dispose: vi.fn() } }
    getSelection() { return '' }
    onSelectionChange() { return { dispose: vi.fn() } }
    write() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {}; dispose() {} } }))
vi.mock('@wailsio/runtime', () => ({ Events: { On: vi.fn(() => vi.fn()) } }))
vi.mock('@/lib/wails', () => ({
  TerminalService: {
    Attach: vi.fn(async () => {}),
    Open: vi.fn(async () => 'split-1'),
    Close: vi.fn(async () => {}),
    Resize: vi.fn(async () => {}),
    Write: vi.fn(async () => {}),
  },
}))

import { TerminalSplit } from '@/components/terminal/TerminalSplit'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { useAppStore } from '@/store/appStore'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { ToastContainer, useToastStore } from '@/components/ui/toast'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function StoreDrivenSplit() {
  const request = useAppStore((state) => state.focusRequest)
  const active = useAppStore((state) => state.activeSurface?.type === 'terminal' && state.activeSurface.id === 'tab-1')
  return <TerminalSplit primaryID="primary-1" sessionId={1} active={active} focusRequest={{
    sequence: request.sequence,
    targetTerminalID: request.terminalId ?? null,
  }} />
}

describe('TerminalSplit focus requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalInstances.length = 0
    vi.mocked(TerminalService.Open).mockResolvedValue('split-1')
    vi.mocked(TerminalService.Close).mockResolvedValue(undefined)
    useToastStore.setState({ toasts: [] })
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'Terminal', type: 'terminal', terminalId: 'primary-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      activePaneId: 'split-1',
      focusRequest: { id: '', terminalId: null, sequence: 0 },
      terminalPool: new Map(),
    })
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
  })

  it('does not transfer an old sequence when the active pane changes', async () => {
    const noRequest = { sequence: 0, targetTerminalID: null } as TerminalFocusRequest
    const view = render(<TerminalSplit primaryID="primary-1" sessionId={1} active focusRequest={noRequest} />)
    await waitFor(() => expect(terminalInstances).toHaveLength(2))
    terminalInstances.forEach((terminal) => terminal.focus.mockClear())

    const splitRequest = { sequence: 1, targetTerminalID: 'split-1' } as TerminalFocusRequest
    view.rerender(<TerminalSplit primaryID="primary-1" sessionId={1} active focusRequest={splitRequest} />)
    expect(terminalInstances[0].focus).not.toHaveBeenCalled()
    expect(terminalInstances[1].focus).toHaveBeenCalledOnce()

    act(() => useAppStore.setState({ activePaneId: 'primary-1' }))
    expect(terminalInstances[0].focus).not.toHaveBeenCalled()
    expect(terminalInstances[1].focus).toHaveBeenCalledOnce()
  })

  it('changes direction and closes the split terminal', async () => {
    const request = { sequence: 0, targetTerminalID: null } as TerminalFocusRequest
    render(<TerminalSplit primaryID="primary-1" sessionId={1} active focusRequest={request} />)
    await waitFor(() => expect(terminalInstances).toHaveLength(2))
    act(() => useAppStore.setState({ activePaneId: 'primary-1' }))

    fireEvent.click(screen.getByTitle('垂直分屏'))
    fireEvent.click(screen.getByTitle('关闭分屏'))

    await waitFor(() => expect(TerminalService.Close).toHaveBeenCalledWith('split-1'))
    expect(useAppStore.getState().activePaneId).toBe('primary-1')
    expect(screen.queryByTitle('关闭分屏')).not.toBeInTheDocument()
  })

  it('keeps the split mounted until close succeeds and then requests primary focus', async () => {
    const close = deferred<void>()
    vi.mocked(TerminalService.Close).mockReturnValueOnce(close.promise as ReturnType<typeof TerminalService.Close>)
    render(<StoreDrivenSplit />)
    await waitFor(() => expect(terminalInstances).toHaveLength(2))
    await waitFor(() => expect(screen.getByTitle('关闭分屏')).toBeInTheDocument())
    terminalInstances.forEach((terminal) => terminal.focus.mockClear())

    act(() => useAppStore.getState().requestTerminalFocus('tab-1', 'split-1'))
    expect(terminalInstances[1].focus).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByTitle('关闭分屏'))

    expect(screen.getByTitle('关闭分屏')).toBeInTheDocument()
    expect(useAppStore.getState().activePaneId).toBe('split-1')
    act(() => close.resolve())

    await waitFor(() => expect(screen.queryByTitle('关闭分屏')).not.toBeInTheDocument())
    expect(useAppStore.getState()).toMatchObject({
      activePaneId: 'primary-1',
      focusRequest: { id: 'tab-1', terminalId: 'primary-1', sequence: 2 },
    })
    expect(terminalInstances[0].focus).toHaveBeenCalledOnce()
    expect(terminalInstances[1].focus).toHaveBeenCalledOnce()
  })

  it('preserves a workspace selected while split close is pending', async () => {
    const close = deferred<void>()
    vi.mocked(TerminalService.Close).mockReturnValueOnce(close.promise as ReturnType<typeof TerminalService.Close>)
    render(<StoreDrivenSplit />)
    await waitFor(() => expect(screen.getByTitle('关闭分屏')).toBeInTheDocument())
    act(() => useAppStore.getState().requestTerminalFocus('tab-1', 'split-1'))
    const focusRequest = useAppStore.getState().focusRequest

    fireEvent.click(screen.getByTitle('关闭分屏'))
    act(() => useAppStore.getState().activateWorkspace('sessions'))
    act(() => close.resolve())

    await waitFor(() => expect(screen.queryByTitle('关闭分屏')).not.toBeInTheDocument())
    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'workspace', id: 'sessions' },
      activePaneId: 'primary-1',
      focusRequest,
    })
    expect(terminalInstances[0].focus).not.toHaveBeenCalled()
  })

  it('keeps the split open and reports an explicit close failure', async () => {
    const closeError = new Error('close failed')
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.mocked(TerminalService.Close).mockRejectedValueOnce(closeError)
    render(<><StoreDrivenSplit /><ToastContainer /></>)
    await waitFor(() => expect(screen.getByTitle('关闭分屏')).toBeInTheDocument())
    act(() => useAppStore.getState().requestTerminalFocus('tab-1', 'split-1'))

    fireEvent.click(screen.getByTitle('关闭分屏'))

    expect(await screen.findByRole('alert')).toHaveTextContent('关闭分屏失败: close failed')
    expect(screen.getByTitle('关闭分屏')).toBeInTheDocument()
    expect(useAppStore.getState().activePaneId).toBe('split-1')
    expect(loggerError).toHaveBeenCalledWith('TerminalSplit: failed to close split', closeError)
  })

  it('closes a split returned after the component was cancelled', async () => {
    const open = deferred<string>()
    vi.mocked(TerminalService.Open).mockReturnValueOnce(open.promise as ReturnType<typeof TerminalService.Open>)
    const view = render(<StoreDrivenSplit />)

    view.unmount()
    act(() => open.resolve('late-split'))

    await waitFor(() => expect(TerminalService.Close).toHaveBeenCalledWith('late-split'))
  })

  it('logs split open failures', async () => {
    const openError = new Error('open failed')
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.mocked(TerminalService.Open).mockRejectedValueOnce(openError)
    const request = { sequence: 0, targetTerminalID: null } as TerminalFocusRequest

    render(<TerminalSplit primaryID="primary-1" sessionId={1} active focusRequest={request} />)

    await waitFor(() => expect(loggerError).toHaveBeenCalledWith('TerminalSplit: failed to open split', openError))
  })
})
