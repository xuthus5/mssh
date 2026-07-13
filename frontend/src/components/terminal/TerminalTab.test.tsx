import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const logService = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
}))
vi.mock('@/lib/wails', () => ({
  LogService: {
    StartTerminalRecording: logService.start,
    StopTerminalRecording: logService.stop,
  },
}))
vi.mock('@/components/terminal/TerminalEmulator', () => ({
  TerminalEmulator: ({ focusRequest }: { focusRequest: { sequence: number; targetTerminalID?: string | null } }) => (
    <div data-testid="terminal-emulator">{focusRequest.sequence}:{focusRequest.targetTerminalID ?? 'none'}</div>
  ),
}))
vi.mock('@/components/terminal/TerminalSplit', () => ({
  TerminalSplit: () => <div data-testid="terminal-split" />,
}))
vi.mock('@/components/terminal/TerminalToolbar', () => ({
  TerminalToolbar: ({ isRecording, onToggleRecording, onToggleSplit }: {
    isRecording: boolean
    onToggleRecording: () => void
    onToggleSplit: () => void
  }) => <div>
    <button type="button" onClick={onToggleRecording}>{isRecording ? '停止录制' : '开始录制'}</button>
    <button type="button" onClick={onToggleSplit}>切换分屏</button>
  </div>,
}))

import { TerminalTab } from '@/components/terminal/TerminalTab'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'

const focusRequest = { sequence: 0, targetTerminalID: null }

describe('TerminalTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'server', type: 'terminal', terminalId: 'term-1', sessionId: 7 }],
      terminalPool: new Map([['term-1', { terminal: { cols: 120, rows: 40 } as never, lastUsed: 0 }]]),
      recordingState: {},
      activePaneId: null,
    })
  })

  it('selects the primary pane and toggles the split viewport', () => {
    render(<TerminalTab terminalID="term-1" sessionId={7} active focusRequest={focusRequest} onOpenFiles={vi.fn()} />)
    expect(useAppStore.getState().activePaneId).toBe('term-1')
    expect(screen.getByTestId('terminal-emulator')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '切换分屏' }))
    expect(screen.getByTestId('terminal-split')).toBeInTheDocument()
  })

  it('does not pass a split-targeted request to the unsplit primary pane', () => {
    render(<TerminalTab terminalID="term-1" sessionId={7} active
      focusRequest={{ sequence: 3, targetTerminalID: 'split-1' }} onOpenFiles={vi.fn()} />)

    expect(screen.getByTestId('terminal-emulator')).toHaveTextContent('0:none')
  })

  it('starts and stops recording with the active terminal dimensions', async () => {
    render(<TerminalTab terminalID="term-1" sessionId={7} active focusRequest={focusRequest} onOpenFiles={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '开始录制' }))
    await waitFor(() => expect(logService.start).toHaveBeenCalledWith('term-1', 7, 120, 40, 'xterm-256color'))
    expect(useAppStore.getState().recordingState['term-1']).toBe('recording')

    fireEvent.click(screen.getByRole('button', { name: '停止录制' }))
    await waitFor(() => expect(logService.stop).toHaveBeenCalledWith('term-1'))
    expect(useAppStore.getState().recordingState['term-1']).toBe('idle')
  })

  it('restores recording state when start and stop requests fail', async () => {
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    logService.start.mockRejectedValueOnce(new Error('start failed'))
    const view = render(<TerminalTab terminalID="term-1" sessionId={7} active focusRequest={focusRequest} onOpenFiles={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '开始录制' }))
    await waitFor(() => expect(useAppStore.getState().recordingState['term-1']).toBe('error'))

    act(() => useAppStore.getState().setRecordingState('term-1', 'recording'))
    logService.stop.mockRejectedValueOnce(new Error('stop failed'))
    view.rerender(<TerminalTab terminalID="term-1" sessionId={7} active focusRequest={focusRequest} onOpenFiles={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '停止录制' }))
    await waitFor(() => expect(useAppStore.getState().recordingState['term-1']).toBe('recording'))
    expect(loggerError).toHaveBeenCalledTimes(2)
  })
})
