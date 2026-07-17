import { forwardRef, useImperativeHandle } from 'react'
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
const splitAction = vi.hoisted(() => vi.fn())
vi.mock('@/components/terminal/TerminalSplit', () => ({
  TerminalSplit: forwardRef(function MockTerminalSplit(_props, ref) {
    useImperativeHandle(ref, () => ({ split: splitAction }))
    return <div data-testid="terminal-split" />
  }),
}))
vi.mock('@/components/terminal/TerminalSearchBar', () => ({
  TerminalSearchBar: ({ terminalID, open }: { terminalID: string; open: boolean }) => open ? <div data-testid={`search-${terminalID}`} /> : null,
}))
vi.mock('@/components/terminal/TerminalToolbar', () => ({
  TerminalToolbar: ({ isRecording, onToggleRecording, onSplit, onToggleSearch }: {
    isRecording: boolean
    onToggleRecording: () => void
    onSplit: (direction: 'horizontal') => void
    onToggleSearch: () => void
  }) => <div>
    <button type="button" onClick={onToggleRecording}>{isRecording ? '停止录制' : '开始录制'}</button>
    <button type="button" onClick={() => onSplit('horizontal')}>向右分屏</button>
    <button type="button" onClick={onToggleSearch}>搜索终端</button>
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
      connectionStatus: { 'term-1': 'connected' },
    })
  })

  it('routes repeated split actions to the persistent split workspace', () => {
    useAppStore.setState({ activePaneId: 'split-1' })
    render(<TerminalTab terminalID="term-1" sessionId={7} active focusRequest={focusRequest} onOpenFiles={vi.fn()} />)
    expect(useAppStore.getState().activePaneId).toBe('split-1')
    expect(screen.getByTestId('terminal-split')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '向右分屏' }))
    fireEvent.click(screen.getByRole('button', { name: '向右分屏' }))
    expect(splitAction).toHaveBeenCalledTimes(2)
    expect(splitAction).toHaveBeenCalledWith('horizontal')
    fireEvent.click(screen.getByRole('button', { name: '搜索终端' }))
    expect(screen.getByTestId('search-split-1')).toBeInTheDocument()
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

  it('records the active split terminal instead of the original primary terminal', async () => {
    useAppStore.setState({
      activePaneId: 'split-1',
      terminalPool: new Map([['split-1', { terminal: { cols: 90, rows: 30 } as never, lastUsed: 1 }]]),
    })
    render(<TerminalTab terminalID="term-1" sessionId={7} active focusRequest={focusRequest} onOpenFiles={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '开始录制' }))

    await waitFor(() => expect(logService.start).toHaveBeenCalledWith('split-1', 7, 90, 30, 'xterm-256color'))
  })

  it('marks failed stops as ended and allows recording to restart', async () => {
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    logService.start.mockRejectedValueOnce(new Error('start failed'))
    const view = render(<TerminalTab terminalID="term-1" sessionId={7} active focusRequest={focusRequest} onOpenFiles={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '开始录制' }))
    await waitFor(() => expect(useAppStore.getState().recordingState['term-1']).toBe('error'))

    act(() => useAppStore.getState().setRecordingState('term-1', 'recording'))
    logService.stop.mockRejectedValueOnce(new Error('stop failed'))
    view.rerender(<TerminalTab terminalID="term-1" sessionId={7} active focusRequest={focusRequest} onOpenFiles={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '停止录制' }))
    await waitFor(() => expect(useAppStore.getState().recordingState['term-1']).toBe('error'))

    fireEvent.click(screen.getByRole('button', { name: '开始录制' }))
    await waitFor(() => expect(logService.start).toHaveBeenCalledTimes(2))
    expect(useAppStore.getState().recordingState['term-1']).toBe('recording')
    expect(loggerError).toHaveBeenCalledTimes(2)
  })

})
