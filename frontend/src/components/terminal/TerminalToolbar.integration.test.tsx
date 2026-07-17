import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listRecordings = vi.hoisted(() => vi.fn())
const deleteRecording = vi.hoisted(() => vi.fn())

vi.mock('@/lib/wails', () => ({
  LogService: {
    Delete: deleteRecording,
    List: listRecordings,
  },
}))

import { TerminalToolbar } from '@/components/terminal/TerminalToolbar'
import { useAppStore } from '@/store/appStore'

const recording = {
  id: 7,
  session_id: 1,
  started_at: '2026-07-13T10:00:00Z',
  ended_at: '2026-07-13T10:01:00Z',
  data_path: '/tmp/recording-7.msshlog',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('TerminalToolbar recording history integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listRecordings.mockResolvedValue([recording])
    useAppStore.setState({
      tabs: [],
      activeSurface: null,
      activePaneId: null,
      terminalPool: new Map(),
    })
  })

  it('keeps recording actions singular and preserves nested delete state', async () => {
    const deletion = deferred<void>()
    deleteRecording.mockReturnValue(deletion.promise)
    render(<TerminalToolbar terminalID="terminal-1" sessionId={1} isRecording={false}
      recordingLogId={null} onToggleRecording={vi.fn()} onOpenFiles={vi.fn()}
      onSplit={vi.fn()} splitDisabled={false} paneCount={1} />)

    const historyButton = screen.getByTitle('录制记录')
    await userEvent.click(historyButton)
    const popover = await screen.findByRole('dialog', { name: '录制记录' })

    expect(screen.getAllByTitle('开始录制')).toHaveLength(1)
    expect(within(popover).queryByRole('button', { name: '录制' })).not.toBeInTheDocument()
    expect(await within(popover).findByText('录制 #7')).toBeInTheDocument()

    await userEvent.click(within(popover).getByRole('button', { name: '删除录制 #7' }))
    const confirmation = await screen.findByRole('alertdialog', { name: '删除录制记录？' })
    await userEvent.click(within(confirmation).getByRole('button', { name: '删除' }))

    expect(within(confirmation).getByRole('button', { name: '删除中...' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(popover).toBeInTheDocument()
    expect(confirmation).toBeInTheDocument()

    await act(async () => { deletion.resolve(undefined) })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(deleteRecording).toHaveBeenCalledWith(7)
    expect(within(popover).queryByText('录制 #7')).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(popover).not.toBeInTheDocument())
    expect(historyButton).toHaveFocus()
  })
})
