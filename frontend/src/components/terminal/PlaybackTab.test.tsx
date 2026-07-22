import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

const { getRecording } = vi.hoisted(() => ({ getRecording: vi.fn(async (): Promise<any> => ({ entries: [] })) }))
const initialTerminalTheme = useAppStore.getState().terminalTheme
const terminalInstances: Array<{
  options: Record<string, any>
  writeln: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  getSelection: ReturnType<typeof vi.fn>
  onSelectionChange: ReturnType<typeof vi.fn>
  triggerSelectionChange: () => void
  selectionSubscription: { dispose: ReturnType<typeof vi.fn> }
}> = []
const fitInstances: Array<{ fit: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = []
const resizeHandlers: ResizeObserverCallback[] = []
let playbackWriteError: Error | null = null
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options: Record<string, any>
  writeln = vi.fn()
  open = vi.fn()
  reset = vi.fn()
  refresh = vi.fn()
  rows = 24
  private addons: Array<{ dispose: () => void }> = []
  private terminalDispose = vi.fn()
  private selectionChange: (() => void) | undefined
  selectionSubscription = { dispose: vi.fn() }
  focus = vi.fn()
  getSelection = vi.fn(() => '')
  onSelectionChange = vi.fn((callback: () => void) => {
    this.selectionChange = callback
    return this.selectionSubscription
  })
  triggerSelectionChange = () => this.selectionChange?.()
  write = vi.fn(() => { if (playbackWriteError) throw playbackWriteError })
  dispose = vi.fn(() => { this.addons.forEach((addon) => addon.dispose()); this.terminalDispose() })
  loadAddon = vi.fn((addon: { dispose: () => void }) => { this.addons.push(addon) })
  constructor(options: Record<string, any>) { this.options = options; terminalInstances.push(this) }
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn(); constructor() { fitInstances.push(this) } } }))
vi.mock('@/lib/wails', () => ({ LogService: { GetRecording: getRecording } }))
vi.mock('@/components/ui/slider', () => ({
  Slider: ({ value, onValueChange }: { value: number[]; onValueChange: (value: number[]) => void }) => (
    <input aria-label="回放进度" type="range" value={value[0]} onChange={(event) => onValueChange([Number(event.target.value)])} />
  ),
}))

import { PlaybackTab } from '@/components/terminal/PlaybackTab'
import { TerminalErrorBoundary } from '@/components/terminal/TerminalErrorBoundary'

describe('PlaybackTab terminal theme', () => {
  afterEach(() => vi.useRealTimers())

  beforeEach(() => {
    terminalInstances.length = 0
    fitInstances.length = 0
    resizeHandlers.length = 0
    getRecording.mockResolvedValue({ entries: [] })
    playbackWriteError = null
    useAppStore.getState().setTerminalTheme({ ...initialTerminalTheme })
    useTerminalBehaviorStore.setState({ rightClickAction: 'menu', copyOnSelect: false, autoReconnect: false, restoreTabsOnStartup: true, scrollbackLines: 10000, renderer: 'dom', historyPredict: false })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      constructor(callback: ResizeObserverCallback) { resizeHandlers.push(callback) }
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
  })

  it('stretches the playback terminal across the available layer', async () => {
    useAppStore.getState().setTerminalTheme({ ...useAppStore.getState().terminalTheme, fontFamily: 'Global Font', fontSize: 17, cursorStyle: 'bar' })
    render(<PlaybackTab recordingId="1" title="demo" active />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(screen.getByRole('region', { name: '回放: demo' })).toHaveClass(
      'flex-1',
      'min-h-0',
      'min-w-0',
      'w-full',
      'overflow-hidden',
    )
    expect(terminalInstances[0].options).toMatchObject({ fontFamily: 'Global Font', fontSize: 17, cursorStyle: 'bar' })
    expect(screen.getByLabelText('回放终端')).toHaveClass(
      'flex-1',
      'min-h-0',
      'min-w-0',
      'w-full',
      'overflow-hidden',
    )
  })
  it('hot-applies terminal theme changes to an open playback terminal', async () => {
    render(<PlaybackTab recordingId="1" title="demo" active />)
    await waitFor(() => expect(terminalInstances).toHaveLength(1))
    fitInstances[0].fit.mockClear()
    terminalInstances[0].refresh.mockClear()
    useAppStore.getState().setTerminalTheme({ ...useAppStore.getState().terminalTheme, background: '#123456', fontFamily: 'Global Font', fontSize: 18, cursorStyle: 'underline' })
    await waitFor(() => expect(terminalInstances[0].options).toMatchObject({ fontFamily: 'Global Font', fontSize: 18, cursorStyle: 'underline', theme: expect.objectContaining({ background: '#123456' }) }))
    expect(fitInstances[0].fit).toHaveBeenCalledOnce()
    expect(terminalInstances[0].refresh).toHaveBeenCalledOnce()
  })
  it('writes millisecond-timestamped entries after playback starts', async () => {
    getRecording.mockResolvedValue({ entries: [{ timestamp: 0, type: 0, data: 'QQ==' }, { timestamp: 10, type: 0, data: 'Qg==' }] })
    render(<PlaybackTab recordingId="1" title="demo" active />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始回放' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '开始回放' }))
    await waitFor(() => expect(terminalInstances[0].write).toHaveBeenCalledWith(new Uint8Array([65])))
  })
  it('copies selected playback text when copy-on-select starts enabled', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: true, scrollbackLines: 10000, autoReconnect: false, restoreTabsOnStartup: true, renderer: 'dom', historyPredict: false })
    render(<PlaybackTab recordingId="1" title="demo" active />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    terminalInstances[0].getSelection.mockReturnValue('selected playback text')

    terminalInstances[0].triggerSelectionChange()
    await act(async () => { vi.advanceTimersByTime(120) })

    expect(writeText).toHaveBeenCalledWith('selected playback text')
  })
  it('hot-switches copy-on-select after mounting', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: false, scrollbackLines: 10000, autoReconnect: false, restoreTabsOnStartup: true, renderer: 'dom', historyPredict: false })
    const view = render(<PlaybackTab recordingId="1" title="demo" active />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const terminal = terminalInstances[0]
    terminal.getSelection.mockReturnValue('selected playback text')

    act(() => useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: true, scrollbackLines: 10000, autoReconnect: false, restoreTabsOnStartup: true, renderer: 'dom', historyPredict: false }))
    terminal.triggerSelectionChange()
    await act(async () => { vi.advanceTimersByTime(120) })
    expect(writeText).toHaveBeenCalledOnce()

    terminal.triggerSelectionChange()
    act(() => useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: false, scrollbackLines: 10000, autoReconnect: false, restoreTabsOnStartup: true, renderer: 'dom', historyPredict: false }))
    await act(async () => { vi.advanceTimersByTime(120) })

    expect(writeText).toHaveBeenCalledOnce()
    view.unmount()
  })
  it('disposes pending playback copy-on-select resources', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: true, scrollbackLines: 10000, autoReconnect: false, restoreTabsOnStartup: true, renderer: 'dom', historyPredict: false })
    const view = render(<PlaybackTab recordingId="1" title="demo" active />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const terminal = terminalInstances[0]
    terminal.getSelection.mockReturnValue('selected playback text')

    terminal.triggerSelectionChange()
    view.unmount()
    await act(async () => { vi.advanceTimersByTime(120) })

    expect(writeText).not.toHaveBeenCalled()
    expect(terminal.selectionSubscription.dispose).toHaveBeenCalledOnce()
  })
  it('reports missing and failed recording loads in the terminal', async () => {
    getRecording.mockResolvedValueOnce(null)
    const missing = render(<PlaybackTab recordingId="missing" title="demo" active />)
    await waitFor(() => expect(terminalInstances[0].writeln).toHaveBeenCalledWith(expect.stringContaining('No recording data found')))
    missing.unmount()

    const loadError = new Error('recording unavailable')
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    getRecording.mockRejectedValueOnce(loadError)
    render(<PlaybackTab recordingId="failed" title="demo" active />)

    await waitFor(() => expect(terminalInstances[1].writeln).toHaveBeenCalledWith(expect.stringContaining('Failed to load recording')))
    expect(loggerError).toHaveBeenCalledWith('PlaybackTab: GetRecording error:', loadError)
  })
  it('pauses, changes speed, and seeks without remounting', async () => {
    getRecording.mockResolvedValue({ entries: [{ timestamp: 0, type: 0, data: 'QQ==' }, { timestamp: 1000, type: 0, data: 'Qg==' }] })
    render(<PlaybackTab recordingId="1" title="demo" active />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始回放' })).toBeEnabled())

    await userEvent.click(screen.getByRole('button', { name: '2x' }))
    expect(screen.getAllByText('2x')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: '开始回放' }))
    await userEvent.click(screen.getByRole('button', { name: '暂停回放' }))
    fireEvent.change(screen.getByRole('slider', { name: '回放进度' }), { target: { value: '50' } })

    expect(screen.getByRole('button', { name: '开始回放' })).toBeInTheDocument()
    expect(terminalInstances[0].reset).toHaveBeenCalledOnce()
    expect(terminalInstances[0].write).toHaveBeenCalledWith(new Uint8Array([65]))
  })
  it('refits and refreshes when a hidden playback becomes visible', async () => {
    const { rerender } = render(<PlaybackTab recordingId="1" title="demo" active={false} />)
    await waitFor(() => expect(terminalInstances).toHaveLength(1))
    fitInstances[0].fit.mockClear()

    rerender(<PlaybackTab recordingId="1" title="demo" active />)

    await waitFor(() => expect(fitInstances[0].fit).toHaveBeenCalledOnce())
    expect(terminalInstances[0].refresh).toHaveBeenCalledOnce()
  })
  it('recovers a zero-size playback on the first visible resize', async () => {
    let width = 0
    let height = 0
    const animationFrames: FrameRequestCallback[] = []
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    })
    const view = render(<PlaybackTab recordingId="1" title="demo" active={false} />)
    await waitFor(() => expect(terminalInstances).toHaveLength(1))

    view.rerender(<PlaybackTab recordingId="1" title="demo" active />)
    act(() => animationFrames.shift()?.(0))
    expect(fitInstances[0].fit).not.toHaveBeenCalled()
    expect(terminalInstances[0].refresh).not.toHaveBeenCalled()

    width = 800
    height = 500
    act(() => resizeHandlers[0]([], {} as ResizeObserver))
    expect(fitInstances[0].fit).toHaveBeenCalledOnce()
    expect(terminalInstances[0].refresh).toHaveBeenCalledOnce()
  })
  it('keeps writing and advancing progress while hidden, then refits when visible', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let nextFrameID = 0
    const animationFrames = new Map<number, FrameRequestCallback>()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameID = ++nextFrameID
      animationFrames.set(frameID, callback)
      return frameID
    })
    vi.stubGlobal('cancelAnimationFrame', (frameID: number) => { animationFrames.delete(frameID) })
    getRecording.mockResolvedValue({ entries: [
      { timestamp: 0, type: 0, data: 'QQ==' },
      { timestamp: 100, type: 0, data: 'Qg==' },
      { timestamp: 1000, type: 0, data: 'Qw==' },
    ] })
    const view = render(<PlaybackTab recordingId="1" title="demo" active />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: '开始回放' }))
    view.rerender(<PlaybackTab recordingId="1" title="demo" active={false} />)

    act(() => vi.advanceTimersByTime(120))
    expect(terminalInstances[0].write).toHaveBeenCalledWith(new Uint8Array([65]))
    expect(terminalInstances[0].write).toHaveBeenCalledWith(new Uint8Array([66]))
    expect(Number((screen.getByRole('slider', { name: '回放进度' }) as HTMLInputElement).value)).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '暂停回放' })).toBeInTheDocument()

    fitInstances[0].fit.mockClear()
    terminalInstances[0].refresh.mockClear()
    view.rerender(<PlaybackTab recordingId="1" title="demo" active />)
    act(() => {
      const callbacks = [...animationFrames.values()]
      animationFrames.clear()
      callbacks.forEach((callback) => callback(0))
    })
    expect(fitInstances[0].fit).toHaveBeenCalledOnce()
    expect(terminalInstances[0].refresh).toHaveBeenCalledOnce()
  })

  it('disposes the fit addon and terminal once', () => {
    const { unmount } = render(<PlaybackTab recordingId="1" title="demo" active />)

    unmount()
    unmount()

    expect(fitInstances[0].dispose).toHaveBeenCalledOnce()
    expect(terminalInstances[0].dispose).toHaveBeenCalledOnce()
  })

  it('reports playback timer failures to its tab boundary', async () => {
    vi.useFakeTimers()
    getRecording.mockResolvedValue({ entries: [{ timestamp: 0, type: 0, data: 'QQ==' }, { timestamp: 1000, type: 0, data: 'Qg==' }] })
    render(
      <TerminalErrorBoundary onClose={vi.fn()}>
        <PlaybackTab recordingId="1" title="demo" active />
      </TerminalErrorBoundary>,
    )
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    playbackWriteError = new Error('playback write failed')
    fireEvent.click(screen.getByRole('button', { name: '开始回放' }))
    act(() => vi.advanceTimersByTime(20))

    expect(screen.getByText('终端渲染失败')).toBeInTheDocument()
  })
})
