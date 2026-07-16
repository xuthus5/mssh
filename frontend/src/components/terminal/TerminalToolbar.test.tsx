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
vi.mock('@/components/session/TunnelDialog', () => ({
  default: ({ open, sessionId }: { open: boolean; sessionId: string }) => <div data-testid="tunnel-dialog" data-open={open} data-session-id={sessionId} />,
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
      onToggleRecording={vi.fn()} hostname="server" onOpenFiles={vi.fn()} onToggleSplit={vi.fn()} split />)

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
      onToggleRecording={vi.fn()} hostname="server" onOpenFiles={vi.fn()} onToggleSplit={vi.fn()} split={false} />)

    expect(screen.getByTitle('隧道管理')).toBeInTheDocument()
    await userEvent.click(screen.getByTitle('隧道管理'))
    expect(screen.getByTestId('tunnel-dialog')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('tunnel-dialog')).toHaveAttribute('data-session-id', '7')
  })

  it('runs toolbar callbacks and bridges recording list actions', async () => {
    const onOpenFiles = vi.fn()
    const onToggleSplit = vi.fn()
    const onToggleRecording = vi.fn()
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    render(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording recordingLogId={null}
      onToggleRecording={onToggleRecording} onOpenFiles={onOpenFiles} onToggleSplit={onToggleSplit} split={false} />)

    await userEvent.click(screen.getByTitle('文件管理'))
    await userEvent.click(screen.getByTitle('分屏'))
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
    expect(onToggleSplit).toHaveBeenCalledOnce()
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
      onToggleRecording={vi.fn()} onOpenFiles={vi.fn()} onToggleSplit={vi.fn()} split={false} />)

    await userEvent.click(screen.getByTitle('复制 (Ctrl+Shift+C)'))
    expect(writeText).not.toHaveBeenCalled()
    expect(empty.focus).toHaveBeenCalledOnce()

    useAppStore.setState({ terminalPool: new Map() })
    view.rerender(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} onOpenFiles={vi.fn()} onToggleSplit={vi.fn()} split={false} />)
    await userEvent.click(screen.getByTitle('粘贴 (Ctrl+Shift+V)'))
    await userEvent.click(screen.getByTitle('清屏 (Ctrl+Shift+L)'))
    expect(readText).not.toHaveBeenCalled()
  })

  it('keeps the recording popover open while its delete dialog is active', async () => {
    render(<TerminalToolbar terminalID="primary-1" sessionId={1} isRecording={false} recordingLogId={null}
      onToggleRecording={vi.fn()} onOpenFiles={vi.fn()} onToggleSplit={vi.fn()} split={false} />)

    await userEvent.click(screen.getByTitle('录制记录'))
    await userEvent.click(screen.getByRole('button', { name: 'block close' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByTestId('session-log')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'allow close' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('session-log')).not.toBeInTheDocument())
  })
})
