import { createRef, useRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/terminal/TerminalEmulator', () => ({
  TerminalEmulator: ({ terminalID }: { terminalID: string }) => <div data-testid={`pane-${terminalID}`}>{terminalID}</div>,
}))
vi.mock('@/lib/wails', () => ({
  TerminalService: {
    Open: vi.fn(),
    OpenLocal: vi.fn(),
    OpenSerial: vi.fn(),
    Close: vi.fn(async () => {}),
  },
}))

import { TerminalSplit, type TerminalSplitHandle } from '@/components/terminal/TerminalSplit'
import { TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { ToastContainer, useToastStore } from '@/components/ui/toast'

const focusRequest = { sequence: 0, targetTerminalID: null }
const splitStateChange = vi.fn()
const closeTerminal = vi.fn()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function Harness() {
  const splitRef = useRef<TerminalSplitHandle>(null)
  const terminalSplitProps = { onCloseTerminal: closeTerminal }
  return <>
    <button type="button" onClick={() => splitRef.current?.split('horizontal')}>向右</button>
    <button type="button" onClick={() => splitRef.current?.split('vertical')}>向下</button>
    <TerminalSplit ref={splitRef} tabID="tab-1" primaryID="primary-1" sessionId={1} active focusRequest={focusRequest} onStateChange={splitStateChange} {...terminalSplitProps} />
  </>
}

describe('TerminalSplit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    splitStateChange.mockClear()
    closeTerminal.mockClear()
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

  it('keeps the initial terminal pane expanded to the full viewport', () => {
    render(<Harness />)

    expect(screen.getByTestId('pane-host-primary-1')).toHaveClass('h-full', 'w-full')
    expect(screen.getByTestId('pane-primary-1')).toBeInTheDocument()
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
    // openTerminalWithPoolCapacity awaits async capacity checks before Open.
    await waitFor(() => expect(TerminalService.Open).toHaveBeenCalledOnce())
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

    expect(await screen.findByRole('status')).toHaveTextContent('每个标签最多支持 8 个终端窗格')
    expect(TerminalService.Open).toHaveBeenCalledTimes(7)
    view.unmount()
  })

  it('shows inline banner when persisted split layout restore fails without toast', async () => {
    useAppStore.setState({
      tabs: [{
        id: 'tab-1',
        title: 'Terminal',
        type: 'terminal',
        terminalId: 'primary-1',
        sessionId: 1,
        splitLayout: {
          paneCount: 2,
          tree: {
            kind: 'branch',
            direction: 'horizontal',
            ratio: 0.5,
            first: { kind: 'leaf', role: 0 },
            second: { kind: 'leaf', role: 1 },
          },
        },
        splitPaneIDs: ['primary-1'],
      }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      activePaneId: 'primary-1',
      focusRequest: { id: 'tab-1', terminalId: 'primary-1', sequence: 1 },
      terminalPool: new Map(),
      connectionStatus: { 'primary-1': 'connected' },
    })
    useToastStore.setState({ toasts: [] })
    // Strict Mode can remount; keep failing until the retry path explicitly succeeds.
    vi.mocked(TerminalService.Open).mockReset().mockRejectedValue(new Error('pool full'))
    render(<Harness />)
    expect(await screen.findByText(/恢复分屏布局失败: pool full/)).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
    vi.mocked(TerminalService.Open).mockReset().mockResolvedValue('split-1' as never)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByTestId('pane-split-1')
    await waitFor(() => expect(screen.queryByText(/恢复分屏布局失败/)).not.toBeInTheDocument())
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
    const previousPane = screen.getByTestId('pane-split-1')
    const terminal = { focus: vi.fn() }
    useAppStore.setState({ terminalPool: new Map([['split-1', { terminal: terminal as never, lastUsed: 10 }]]) })
    act(() => useAppStore.getState().setConnectionStatus('split-1', 'disconnected'))

    fireEvent.click(screen.getByRole('button', { name: '重新连接' }))

    const reconnectedPane = await screen.findByTestId('pane-split-2')
    expect(screen.getByTestId('pane-primary-1')).toBeInTheDocument()
    expect(screen.queryByTestId('pane-split-1')).not.toBeInTheDocument()
    expect(reconnectedPane).toBe(previousPane)
    expect(useAppStore.getState().terminalPool.get('split-2')?.terminal).toBe(terminal)
    expect(useAppStore.getState().terminalPool.has('split-1')).toBe(false)
    expect(TerminalService.Close).toHaveBeenCalledWith('split-1')
    expect(useAppStore.getState().connectionStatus['split-2']).toBe('connected')
  })

  it('preserves the primary terminal instance and runtime mapping after reconnect', async () => {
    const terminal = { focus: vi.fn() }
    useAppStore.setState({ terminalPool: new Map([['primary-1', { terminal: terminal as never, lastUsed: 10 }]]) })
    render(<Harness />)
    const previousPane = screen.getByTestId('pane-primary-1')
    act(() => useAppStore.getState().setConnectionStatus('primary-1', 'disconnected'))

    fireEvent.click(screen.getByRole('button', { name: '重新连接' }))

    const reconnectedPane = await screen.findByTestId('pane-split-1')
    expect(reconnectedPane).toBe(previousPane)
    expect(useAppStore.getState().tabs[0]).toMatchObject({ terminalId: 'split-1' })
    expect(useAppStore.getState().terminalPool.get('split-1')?.terminal).toBe(terminal)
    expect(useAppStore.getState().terminalPool.has('primary-1')).toBe(false)
  })

  it('shows a spacious disconnect panel with reconnect and close actions', async () => {
    render(<Harness />)
    act(() => useAppStore.getState().setConnectionStatus('primary-1', 'disconnected'))

    const alert = screen.getByRole('alert')
    expect(alert.firstElementChild).toHaveClass('max-w-sm', 'p-5')
    expect(screen.getByText('会话可能因空闲超时、进程退出或网络中断而结束，可在当前终端中重新连接。')).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: '关闭终端' }))
    expect(closeTerminal).toHaveBeenCalledOnce()
    expect(TerminalService.Close).not.toHaveBeenCalled()
  })

  it('closes a disconnected split pane from the overlay action', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('向右'))
    await screen.findByTestId('pane-split-1')
    act(() => useAppStore.getState().setConnectionStatus('split-1', 'disconnected'))

    fireEvent.click(screen.getByRole('button', { name: '关闭终端' }))

    await waitFor(() => expect(screen.queryByTestId('pane-split-1')).not.toBeInTheDocument())
    expect(screen.getByTestId('pane-primary-1')).toBeInTheDocument()
    expect(TerminalService.Close).toHaveBeenCalledWith('split-1')
    expect(closeTerminal).not.toHaveBeenCalled()
  })

  it('closes all secondary terminals when the tab unmounts', async () => {
    const view = render(<Harness />)
    fireEvent.click(screen.getByText('向右'))
    await screen.findByTestId('pane-split-1')

    view.unmount()

    await waitFor(() => expect(TerminalService.Close).toHaveBeenCalledWith('split-1'))
    expect(TerminalService.Close).not.toHaveBeenCalledWith('primary-1')
  })

it('preserves the primary pane host when splitting', async () => {
    render(<Harness />)
    const primaryHost = screen.getByTestId('pane-host-primary-1')
    fireEvent.click(screen.getByText('向右'))
    await screen.findByTestId('pane-split-1')
    expect(screen.getByTestId('pane-host-primary-1')).toBe(primaryHost)
    expect(screen.getByTestId('pane-primary-1')).toBeInTheDocument()
    expect(TerminalService.Close).not.toHaveBeenCalled()
  })

  it('opens local shell panes with OpenLocal', async () => {
    vi.mocked(TerminalService.OpenLocal).mockResolvedValue('local-split-1')
    const splitRef = createRef<TerminalSplitHandle>()
    render(
      <TerminalSplit
        ref={splitRef}
        tabID="tab-local"
        primaryID="primary-local"
        sessionId={0}
        connectionKind="local"
        active
        focusRequest={focusRequest}
        onStateChange={splitStateChange}
        onCloseTerminal={closeTerminal}
      />,
    )
    act(() => splitRef.current?.split('horizontal'))
    await screen.findByTestId('pane-local-split-1')
    expect(TerminalService.OpenLocal).toHaveBeenCalled()
    expect(TerminalService.Open).not.toHaveBeenCalled()
  })
  it('tracks live split pane IDs for pool protection after local split', async () => {
    vi.mocked(TerminalService.OpenLocal).mockResolvedValue('local-split-1')
    useAppStore.setState({
      tabs: [{ id: 'tab-local', title: '本地终端', type: 'terminal', terminalId: 'primary-local', sessionId: 0, connectionKind: 'local' }],
      activeSurface: { type: 'terminal', id: 'tab-local' },
      activePaneId: 'primary-local',
      connectionStatus: { 'primary-local': 'connected' },
      terminalPool: new Map(),
    })
    const splitRef = createRef<TerminalSplitHandle>()
    render(
      <TerminalSplit
        ref={splitRef}
        tabID="tab-local"
        primaryID="primary-local"
        sessionId={0}
        connectionKind="local"
        active
        focusRequest={focusRequest}
        onStateChange={splitStateChange}
        onCloseTerminal={closeTerminal}
      />,
    )
    act(() => splitRef.current?.split('horizontal'))
    await screen.findByTestId('pane-local-split-1')
    const tab = useAppStore.getState().tabs.find((item) => item.id === 'tab-local')
    expect(tab?.type === 'terminal' && tab.splitPaneIDs).toEqual(expect.arrayContaining(['primary-local', 'local-split-1']))
    expect(useAppStore.getState().connectionStatus['primary-local']).toBe('connected')
  })

})
