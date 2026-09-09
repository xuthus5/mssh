import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectDialog } from '@/components/layout/ConnectDialog'
import { useConnectDialog } from '@/store/connectDialog'
import { useHostKeyPromptDialog, type HostKeyPromptRequest } from '@/store/hostKeyPromptDialog'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'

function presentPrompt(overrides: Partial<HostKeyPromptRequest> = {}) {
  const request: HostKeyPromptRequest = {
    coordinatorId: 1,
    prompt: { attemptId: 'attempt-1', hostname: 'server.internal:22', fingerprint: 'SHA256:test', algorithm: 'ssh-ed25519', changed: false, expected: [] },
    endpoint: { host: 'server.internal', port: 22 },
    decide: vi.fn(async () => {}),
    dismiss: vi.fn(async () => {}),
    ...overrides,
  }
  act(() => { useHostKeyPromptDialog.getState().present(request) })
  return request
}

function openConnection() {
  return useConnectDialog.getState().openDialog('server.internal', 22, 'root', vi.fn(), '5')
}

beforeEach(() => {
  useConnectDialog.setState(useConnectDialog.getInitialState())
  useHostKeyPromptDialog.setState(useHostKeyPromptDialog.getInitialState())
  useAppStore.setState({ tabs: [], activeSurface: null, activePaneId: null, terminalPool: new Map() })
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('unified SSH connection dialog', () => {
  it('keeps one modal through connecting, fingerprint confirmation, and terminal success', async () => {
    const dialogId = openConnection()
    render(<ConnectDialog />)
    const modal = screen.getByRole('dialog')
    expect(within(modal).getByRole('list', { name: '连接进度' })).toBeInTheDocument()
    expect(screen.getByText('SSH 握手进行中...')).toBeInTheDocument()

    const request = presentPrompt()
    expect(screen.getAllByRole('dialog')).toEqual([modal])
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('SHA256:test')).toBeInTheDocument()
    expect(screen.getByText('主机指纹确认')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拒绝' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: '信任并连接' }))

    expect(request.decide).toHaveBeenCalledWith(true)
    expect(screen.getByRole('dialog')).toBe(modal)
    expect(screen.queryByRole('heading', { name: '连接成功' })).not.toBeInTheDocument()
    act(() => useConnectDialog.getState().completeDialog(dialogId))
    expect(screen.getByRole('heading', { name: '连接成功' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBe(modal)
    await userEvent.click(screen.getByRole('button', { name: '进入终端' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows success for a trusted host before automatically closing', async () => {
    vi.useFakeTimers()
    const dialogId = openConnection()
    const cancel = vi.fn()
    useConnectDialog.getState().setCancelHandler(dialogId, cancel)
    render(<ConnectDialog />)
    act(() => useConnectDialog.getState().completeDialog(dialogId))
    expect(screen.getByRole('heading', { name: '连接成功' })).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTimeAsync(799))
    expect(useConnectDialog.getState().open).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(useConnectDialog.getState().open).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('returns keyboard focus to the opened terminal after the success step', async () => {
    vi.useFakeTimers()
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    const focus = vi.fn(() => textarea.focus())
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'Server', type: 'terminal', sessionId: 5, terminalId: 'terminal-1' }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      terminalPool: new Map([['terminal-1', { terminal: { focus, textarea } as never, lastUsed: Date.now() }]]),
    })
    const dialogId = openConnection()
    render(<ConnectDialog />)
    act(() => useConnectDialog.getState().completeDialog(dialogId))
    expect(focus).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(900))
    expect(focus).toHaveBeenCalled()
    expect(textarea).toHaveFocus()
    textarea.remove()
  })

  it('cleans up the success timer when the dialog host unmounts', async () => {
    vi.useFakeTimers()
    const dialogId = openConnection()
    const view = render(<ConnectDialog />)
    act(() => useConnectDialog.getState().completeDialog(dialogId))
    view.unmount()
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(useConnectDialog.getState()).toMatchObject({ open: true, state: 'connected' })
  })

  it('preserves the selected split pane when a primary terminal reconnect completes', async () => {
    vi.useFakeTimers()
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    const primaryFocus = vi.fn()
    const splitFocus = vi.fn(() => textarea.focus())
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'Server', type: 'terminal', sessionId: 5, terminalId: 'primary', splitPaneIDs: ['primary', 'split'] }],
      activeSurface: { type: 'terminal', id: 'tab-1' }, activePaneId: 'split',
      terminalPool: new Map([
        ['primary', { terminal: { focus: primaryFocus } as never, lastUsed: Date.now() }],
        ['split', { terminal: { focus: splitFocus, textarea } as never, lastUsed: Date.now() }],
      ]),
    })
    const dialogId = openConnection()
    render(<ConnectDialog />)
    act(() => useConnectDialog.getState().completeDialog(dialogId))
    await act(async () => vi.advanceTimersByTimeAsync(900))
    expect(splitFocus).toHaveBeenCalled()
    expect(primaryFocus).not.toHaveBeenCalled()
    expect(textarea).toHaveFocus()
    textarea.remove()
  })

  it('does not steal focus when the next queued connection opens at success dismissal', async () => {
    vi.useFakeTimers()
    const focus = vi.fn()
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'Server', type: 'terminal', sessionId: 5, terminalId: 'primary' }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      terminalPool: new Map([['primary', { terminal: { focus } as never, lastUsed: Date.now() }]]),
    })
    const dialogId = openConnection()
    const unsubscribe = useConnectDialog.subscribe((state, previous) => {
      if (!state.open && previous.state === 'connected') state.openDialog('next.internal', 22, 'root', vi.fn())
    })
    render(<ConnectDialog />)
    act(() => useConnectDialog.getState().completeDialog(dialogId))
    await act(async () => vi.advanceTimersByTimeAsync(900))
    expect(focus).not.toHaveBeenCalled()
    expect(useConnectDialog.getState()).toMatchObject({ open: true, host: 'next.internal', state: 'connecting' })
    unsubscribe()
  })

  it('handles a disposed terminal failing to accept focus after success', async () => {
    vi.useFakeTimers()
    const failure = new Error('terminal disposed')
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'Server', type: 'terminal', sessionId: 5, terminalId: 'primary' }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      terminalPool: new Map([['primary', { terminal: { focus: () => { throw failure } } as never, lastUsed: Date.now() }]]),
    })
    const dialogId = openConnection()
    render(<ConnectDialog />)
    act(() => useConnectDialog.getState().completeDialog(dialogId))
    await act(async () => vi.advanceTimersByTimeAsync(900))
    expect(useConnectDialog.getState().open).toBe(false)
    expect(logError).toHaveBeenCalledWith('focus connected terminal failed', failure)
  })

  it('never lets a success timer close a fingerprint prompt or a newer connection', async () => {
    vi.useFakeTimers()
    const dialogId = openConnection()
    render(<ConnectDialog />)
    act(() => useConnectDialog.getState().completeDialog(dialogId))
    await act(async () => vi.advanceTimersByTimeAsync(400))
    presentPrompt()
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByText('SHA256:test')).toBeInTheDocument()
    expect(useConnectDialog.getState().open).toBe(true)
    await act(async () => { await useHostKeyPromptDialog.getState().decide(false) })
    act(() => useConnectDialog.getState().openDialog('next.internal', 2222, 'admin', vi.fn()))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(useConnectDialog.getState()).toMatchObject({ open: true, host: 'next.internal', state: 'connecting' })
  })

  it('uses the exact background prompt endpoint and never cancels the foreground request', async () => {
    const dialogId = openConnection()
    const cancel = vi.fn()
    useConnectDialog.getState().setCancelHandler(dialogId, cancel)
    render(<ConnectDialog />)
    const request = presentPrompt({ endpoint: { host: '2001:db8::2', port: 2222 } })
    expect(screen.getByText('[2001:db8::2]:2222')).toBeInTheDocument()
    expect(screen.queryByText('root@server.internal:22')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(request.decide).toHaveBeenCalledWith(false)
    expect(cancel).not.toHaveBeenCalled()
    expect(useConnectDialog.getState()).toMatchObject({ open: true, dialogId, state: 'connecting' })
  })

  it('shows a standalone queued fingerprint in the same connection shell', async () => {
    const request = presentPrompt()
    render(<ConnectDialog />)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'SSH 连接' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(request.dismiss).toHaveBeenCalledOnce()
    expect(request.decide).not.toHaveBeenCalled()
  })

  it('keeps decision errors actionable in the same modal', async () => {
    openConnection()
    presentPrompt({ decide: vi.fn(async () => { throw new Error('decision failed') }) })
    render(<ConnectDialog />)
    const modal = screen.getByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: '信任并连接' }))
    expect(screen.getByText('decision failed')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBe(modal)
    expect(screen.getByRole('button', { name: '拒绝' })).toBeEnabled()
  })

  it('keeps failures and retries inside the connection flow', async () => {
    const retry = vi.fn()
    const dialogId = useConnectDialog.getState().openDialog('server.internal', 22, 'root', retry)
    render(<ConnectDialog />)
    act(() => useConnectDialog.getState().failDialog(dialogId, 'authentication failed'))
    expect(screen.getByText('authentication failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(useConnectDialog.getState().open).toBe(false)
  })
})
