import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleteRecording = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/lib/wails', () => ({ LogService: { Delete: deleteRecording } }))
vi.mock('@/components/terminal/SessionLog', () => ({
  default: ({ onPlayback, onDeleteRecording, onDeleteDialogOpenChange }: {
    onPlayback: (path: string, title: string) => void
    onDeleteRecording: (id: number) => Promise<void>
    onDeleteDialogOpenChange: (open: boolean) => void
  }) => <div data-testid="session-log">
    <button type="button" onClick={() => onPlayback('/tmp/replay.msshlog', '回放 #9')}>log playback</button>
    <button type="button" onClick={() => { void onDeleteRecording(9).catch(() => {}) }}>log delete</button>
    <button type="button" onClick={() => onDeleteDialogOpenChange(true)}>block close</button>
    <button type="button" onClick={() => onDeleteDialogOpenChange(false)}>allow close</button>
  </div>,
}))
const loadTunnels = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/hooks/useTunnelManager', () => ({
  useTunnelManager: () => ({
    tunnels: [],
    error: 'tunnel list boom',
    loading: false,
    load: loadTunnels,
    start: vi.fn(),
    stop: vi.fn(),
    remove: vi.fn(),
  }),
}))
vi.mock('@/components/session/TunnelDialog', () => ({
  default: ({ open, sessionId, loadError }: { open: boolean; sessionId: string; loadError?: string }) => (
    <div data-testid="tunnel-dialog" data-open={open} data-session-id={sessionId} data-load-error={loadError ?? ''} />
  ),
}))

import { TerminalToolbar } from '@/components/terminal/TerminalToolbar'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'

function terminal(selection = 'selected') {
  return {
    getSelection: vi.fn(() => selection),
    paste: vi.fn(),
    clear: vi.fn(),
    focus: vi.fn(),
  }
}

describe('TerminalToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadTunnels.mockClear()
    deleteRecording.mockResolvedValue(undefined)
    useAppStore.setState({
      tabs: [],
      activeSurface: null,
      activePaneId: null,
      terminalPool: new Map(),
    })
  })

  it('routes clipboard and clear actions through the active split pane', async () => {
    const primary = terminal('primary')
    const split = terminal('split selection')
    const writeText = vi.fn(async () => {})
    const readText = vi.fn(async () => 'clipboard text')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText } })
    useAppStore.setState({
      activePaneId: 'split-1',
      terminalPool: new Map([
        ['primary-1', { terminal: primary as never, lastUsed: 0 }],
        ['split-1', { terminal: split as never, lastUsed: 0 }],
      ]),
    })
    render(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} hostname="server" onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled={false} paneCount={2} searchOpen={false} onToggleSearch={vi.fn()} />)

    await userEvent.click(screen.getByTitle('复制 (Ctrl+Shift+C)'))
    await userEvent.click(screen.getByTitle('粘贴 (Ctrl+Shift+V)'))
    await userEvent.click(screen.getByTitle('清屏 (Ctrl+Shift+L)'))

    expect(writeText).toHaveBeenCalledWith('split selection')
    expect(split.paste).toHaveBeenCalledWith('clipboard text')
    expect(split.clear).toHaveBeenCalledOnce()
    expect(split.focus).toHaveBeenCalledTimes(3)
    expect(primary.focus).not.toHaveBeenCalled()
    expect(screen.getByText('server')).toBeInTheDocument()
    expect(screen.getByText('server').parentElement).not.toHaveClass('border-b')
  })

  it('opens tunnel management beside the file action', async () => {
    render(<TerminalToolbar terminalID="primary-1" sessionId={7} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} hostname="server" onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled={false} paneCount={1} searchOpen={false} onToggleSearch={vi.fn()} />)

    expect(screen.getByTitle('隧道管理')).toBeInTheDocument()
    await userEvent.click(screen.getByTitle('隧道管理'))
    expect(loadTunnels).toHaveBeenCalled()
    expect(screen.getByTestId('tunnel-dialog')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('tunnel-dialog')).toHaveAttribute('data-session-id', '7')
    expect(screen.getByTestId('tunnel-dialog')).toHaveAttribute('data-load-error', 'tunnel list boom')
  })

  it('places compose directly after files and toggles its active state', async () => {
    const onToggleCompose = vi.fn()
    const view = render(<TerminalToolbar terminalID="primary-1" sessionId={7} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} hostname="server" onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled={false}
      paneCount={1} searchOpen={false} onToggleSearch={vi.fn()} composeOpen={false} onToggleCompose={onToggleCompose} />)

    const titles = screen.getAllByRole('button').map((button) => button.getAttribute('title'))
    expect(titles.indexOf('撰写终端内容')).toBe(titles.indexOf('文件管理') + 1)
    await userEvent.click(screen.getByTitle('撰写终端内容'))
    expect(onToggleCompose).toHaveBeenCalledOnce()

    view.rerender(<TerminalToolbar terminalID="primary-1" sessionId={7} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} hostname="server" onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled={false}
      paneCount={1} searchOpen={false} onToggleSearch={vi.fn()} composeOpen onToggleCompose={onToggleCompose} />)
    expect(screen.getByTitle('关闭撰写面板')).toHaveClass('text-primary')
  })

  it('toggles terminal search from the toolbar', async () => {
    const onToggleSearch = vi.fn()
    const view = render(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled={false} paneCount={1}
      searchOpen={false} onToggleSearch={onToggleSearch} />)

    await userEvent.click(screen.getByTitle('搜索终端内容'))
    expect(onToggleSearch).toHaveBeenCalledOnce()

    view.rerender(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled={false} paneCount={1}
      searchOpen onToggleSearch={onToggleSearch} />)
    expect(screen.getByTitle('关闭终端搜索')).toBeInTheDocument()
  })

  it('places command history directly after terminal search', () => {
    render(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled={false} paneCount={1}
      searchOpen={false} onToggleSearch={vi.fn()} onOpenHistory={vi.fn()} />)

    const toolbarTitles = screen.getAllByRole('button').map((button) => button.getAttribute('title'))
    expect(toolbarTitles.indexOf('命令历史')).toBe(toolbarTitles.indexOf('搜索终端内容') + 1)
    expect(toolbarTitles.indexOf('命令历史')).toBeLessThan(toolbarTitles.indexOf('文件管理'))
  })

  it('runs toolbar callbacks and bridges recording list actions', async () => {
    const onOpenFiles = vi.fn()
    const onSplit = vi.fn()
    const onToggleRecording = vi.fn()
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    render(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording recordingLogId={null}
      onToggleRecording={onToggleRecording} onOpenFiles={onOpenFiles} onSplit={onSplit} splitDisabled={false} paneCount={1} searchOpen={false} onToggleSearch={vi.fn()} />)

    await userEvent.click(screen.getByTitle('文件管理'))
    await userEvent.click(screen.getByTitle('创建分屏'))
    await userEvent.click(screen.getByText('向右分屏'))
    await userEvent.click(screen.getByTitle('停止录制'))
    const historyButton = screen.getByTitle('录制记录')
    await userEvent.click(historyButton)
    expect(screen.getByTestId('session-log')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'log record' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('session-log')).not.toBeInTheDocument())
    expect(historyButton).toHaveFocus()
    await userEvent.click(historyButton)
    await userEvent.click(screen.getByRole('button', { name: 'log playback' }))
    await userEvent.click(screen.getByRole('button', { name: 'log delete' }))

    expect(onOpenFiles).toHaveBeenCalledOnce()
    expect(onSplit).toHaveBeenCalledWith('horizontal')
    expect(onToggleRecording).toHaveBeenCalledOnce()
    expect(useAppStore.getState().tabs).toContainEqual(expect.objectContaining({
      id: 'playback-回放 #9',
      recordingPath: '/tmp/replay.msshlog',
    }))
    expect(deleteRecording).toHaveBeenCalledWith(9)

    deleteRecording.mockRejectedValueOnce(new Error('delete failed'))
    await userEvent.click(screen.getByRole('button', { name: 'log delete' }))
    await waitFor(() => expect(loggerError).toHaveBeenCalledWith(
      'TerminalToolbar: delete recording error:',
      expect.any(Error),
    ))
  })

  it('leaves clipboard actions inert without a terminal or selection', async () => {
    const writeText = vi.fn(async () => {})
    const readText = vi.fn(async () => 'clipboard text')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText } })
    const empty = terminal('')
    useAppStore.setState({ terminalPool: new Map([['primary-1', { terminal: empty as never, lastUsed: 0 }]]) })
    const view = render(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled={false} paneCount={1} searchOpen={false} onToggleSearch={vi.fn()} />)

    await userEvent.click(screen.getByTitle('复制 (Ctrl+Shift+C)'))
    expect(writeText).not.toHaveBeenCalled()
    expect(empty.focus).toHaveBeenCalledOnce()

    useAppStore.setState({ terminalPool: new Map() })
    view.rerender(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled={false} paneCount={1} searchOpen={false} onToggleSearch={vi.fn()} />)
    await userEvent.click(screen.getByTitle('粘贴 (Ctrl+Shift+V)'))
    await userEvent.click(screen.getByTitle('清屏 (Ctrl+Shift+L)'))
    expect(readText).not.toHaveBeenCalled()
  })

  it('disables splitting and explains the eight-pane limit', () => {
    render(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled paneCount={8} searchOpen={false} onToggleSearch={vi.fn()} />)

    expect(screen.getByTitle('已达到 8 个终端窗格上限')).toBeDisabled()
  })

  it('keeps the recording popover open while its delete dialog is active', async () => {
    render(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled={false} paneCount={1} searchOpen={false} onToggleSearch={vi.fn()} />)

    await userEvent.click(screen.getByTitle('录制记录'))
    await userEvent.click(screen.getByRole('button', { name: 'block close' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByTestId('session-log')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'allow close' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('session-log')).not.toBeInTheDocument())
  })

  it('surfaces clipboard failures on the toolbar banner without toast', async () => {
    const writeText = vi.fn(async () => { throw new Error('clipboard denied') })
    const readText = vi.fn(async () => { throw new Error('paste denied') })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText } })
    const term = terminal('selected text')
    useAppStore.setState({
      activePaneId: null,
      terminalPool: new Map([['primary-1', { terminal: term as never, lastUsed: 0 }]]),
    })
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    render(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} hostname="server" onOpenFiles={vi.fn()} onSplit={vi.fn()} splitDisabled={false} paneCount={1} searchOpen={false} onToggleSearch={vi.fn()} />)

    await userEvent.click(screen.getByTitle('复制 (Ctrl+Shift+C)'))
    expect(await screen.findByRole('alert')).toHaveTextContent('复制失败: clipboard denied')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)

    await userEvent.click(screen.getByTitle('粘贴 (Ctrl+Shift+V)'))
    expect(await screen.findByRole('alert')).toHaveTextContent('粘贴失败: paste denied')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })
})
