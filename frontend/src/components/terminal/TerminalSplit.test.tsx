import { createRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/terminal/TerminalEmulator', () => ({
  TerminalEmulator: ({ terminalID }: { terminalID: string }) => <div data-testid={`pane-${terminalID}`}>{terminalID}</div>,
}))
vi.mock('@/lib/wails', () => ({
  TerminalService: {
    Open: vi.fn(),
    Close: vi.fn(async () => {}),
  },
}))

import { TerminalSplit, type TerminalSplitHandle } from '@/components/terminal/TerminalSplit'
import { TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { ToastContainer, useToastStore } from '@/components/ui/toast'

const focusRequest = { sequence: 0, targetTerminalID: null }
const splitStateChange = vi.fn()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function Harness() {
  const splitRef = createRef<TerminalSplitHandle>()
  return <>
    <button type="button" onClick={() => splitRef.current?.split('horizontal')}>向右</button>
    <button type="button" onClick={() => splitRef.current?.split('vertical')}>向下</button>
    <TerminalSplit ref={splitRef} tabID="tab-1" primaryID="primary-1" sessionId={1} active focusRequest={focusRequest} onStateChange={splitStateChange} />
  </>
}

describe('TerminalSplit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    splitStateChange.mockClear()
    vi.mocked(TerminalService.Open).mockReset()
    vi.mocked(TerminalService.Open)
      .mockResolvedValueOnce('split-1')
      .mockResolvedValueOnce('split-2')
      .mockResolvedValueOnce('split-3')
    vi.mocked(TerminalService.Close).mockResolvedValue(undefined)
    useToastStore.setState({ toasts: [] })
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'Terminal', type: 'terminal', terminalId: 'primary-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      activePaneId: 'primary-1',
      focusRequest: { id: 'tab-1', terminalId: 'primary-1', sequence: 1 },
      terminalPool: new Map(),
      connectionStatus: { 'primary-1': 'connected' },
    })
  })

  it('adds a new terminal on every split request without recycling existing panes', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('向右'))
    await screen.findByTestId('pane-split-1')

    act(() => useAppStore.getState().setActivePane('split-1'))
    fireEvent.click(screen.getByText('向下'))

    await screen.findByTestId('pane-split-2')
    expect(screen.getByTestId('pane-primary-1')).toBeInTheDocument()
    expect(screen.getByTestId('pane-split-1')).toBeInTheDocument()
    expect(TerminalService.Open).toHaveBeenCalledTimes(2)
    expect(TerminalService.Close).not.toHaveBeenCalled()
    expect(useAppStore.getState().activePaneId).toBe('split-2')
  })

  it('serializes rapid split requests and enforces the eight-pane limit', async () => {
    const opening = deferred<string>()
    vi.mocked(TerminalService.Open).mockReset().mockReturnValueOnce(opening.promise as unknown as ReturnType<typeof TerminalService.Open>)
    const view = render(<><Harness /><ToastContainer /></>)
    fireEvent.click(screen.getByText('向右'))
    fireEvent.click(screen.getByText('向右'))
    expect(TerminalService.Open).toHaveBeenCalledOnce()
    act(() => opening.resolve('split-1'))
    await screen.findByTestId('pane-split-1')

    let sequence = 1
    vi.mocked(TerminalService.Open).mockImplementation(() => Promise.resolve(`split-${++sequence}`) as unknown as ReturnType<typeof TerminalService.Open>)
    for (let index = 2; index <= 7; index++) {
      fireEvent.click(screen.getByText('向右'))
      await screen.findByTestId(`pane-split-${index}`)
    }
    await waitFor(() => expect(splitStateChange).toHaveBeenLastCalledWith({ paneCount: 8, busy: false }))
    fireEvent.click(screen.getByText('向右'))

    expect(await screen.findByRole('status')).toHaveTextContent('单个标签最多支持 8 个终端窗格')
    expect(TerminalService.Open).toHaveBeenCalledTimes(7)
    view.unmount()
  })

  it('resizes a split with the pointer divider', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('向右'))
    await screen.findByTestId('pane-split-1')
    const separator = screen.getByRole('separator')
    vi.spyOn(separator.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}),
    })

    fireEvent.pointerDown(separator, { clientX: 500 })
    fireEvent.pointerMove(window, { clientX: 750 })
    fireEvent.pointerUp(window)

    expect(separator.previousElementSibling).toHaveStyle({ flexBasis: '75%' })
  })

  it('closes the original primary pane and promotes its sibling', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('向右'))
    await screen.findByTestId('pane-split-1')

    fireEvent.click(screen.getAllByTitle('关闭当前窗格')[0])

    await waitFor(() => expect(screen.queryByTestId('pane-primary-1')).not.toBeInTheDocument())
    expect(TerminalService.Close).toHaveBeenCalledWith('primary-1')
    expect(useAppStore.getState().tabs[0]).toMatchObject({ terminalId: 'split-1' })
    expect(useAppStore.getState().activePaneId).toBe('split-1')
    expect(screen.queryByTitle('关闭当前窗格')).not.toBeInTheDocument()
  })

  it('keeps the layout when opening or closing a pane fails', async () => {
    const openError = new Error('open failed')
    vi.mocked(TerminalService.Open).mockReset().mockRejectedValueOnce(openError)
    render(<><Harness /><ToastContainer /></>)

    fireEvent.click(screen.getByText('向右'))
    expect(await screen.findByRole('alert')).toHaveTextContent('创建分屏失败: open failed')
    expect(screen.getByTestId('pane-primary-1')).toBeInTheDocument()

    vi.mocked(TerminalService.Open).mockResolvedValueOnce('split-1')
    fireEvent.click(screen.getByText('向右'))
    await screen.findByTestId('pane-split-1')
    vi.mocked(TerminalService.Close).mockRejectedValueOnce(new Error('close failed'))
    fireEvent.click(screen.getAllByTitle('关闭当前窗格')[1])
    await waitFor(() => expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent('关闭分屏失败: close failed'))
    expect(screen.getByTestId('pane-split-1')).toBeInTheDocument()
  })

  it('reconnects only the disconnected pane in place', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('向右'))
    await screen.findByTestId('pane-split-1')
    act(() => useAppStore.getState().setConnectionStatus('split-1', 'disconnected'))

    fireEvent.click(screen.getByRole('button', { name: '重新连接' }))

    await screen.findByTestId('pane-split-2')
    expect(screen.getByTestId('pane-primary-1')).toBeInTheDocument()
    expect(screen.queryByTestId('pane-split-1')).not.toBeInTheDocument()
    expect(TerminalService.Close).toHaveBeenCalledWith('split-1')
    expect(useAppStore.getState().connectionStatus['split-2']).toBe('connected')
  })

  it('closes all secondary terminals when the tab unmounts', async () => {
    const view = render(<Harness />)
    fireEvent.click(screen.getByText('向右'))
    await screen.findByTestId('pane-split-1')

    view.unmount()

    await waitFor(() => expect(TerminalService.Close).toHaveBeenCalledWith('split-1'))
    expect(TerminalService.Close).not.toHaveBeenCalledWith('primary-1')
  })
})
