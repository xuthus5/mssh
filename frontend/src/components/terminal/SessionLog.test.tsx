import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listRecordings = vi.hoisted(() => vi.fn())

vi.mock('@/lib/wails', () => ({ LogService: { List: listRecordings } }))
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div role="dialog">{children}</div> : null,
  AlertDialogAction: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} />,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import SessionLog from '@/components/terminal/SessionLog'
import { logger } from '@/lib/logger'

const recording = {
  id: 7,
  session_id: 1,
  started_at: '2026-07-13T10:00:00Z',
  ended_at: '2026-07-13T10:01:00Z',
  data_path: '/tmp/recording-7.msshlog',
}

describe('SessionLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listRecordings.mockResolvedValue([recording])
  })

  it('loads, plays, toggles recording, and removes a recording', async () => {
    const onToggleRecording = vi.fn()
    const onPlayback = vi.fn()
    const onDeleteRecording = vi.fn(async () => {})
    render(<SessionLog sessionId={1} isRecording={false} onToggleRecording={onToggleRecording}
      onPlayback={onPlayback} onDeleteRecording={onDeleteRecording} />)

    await userEvent.click(screen.getByTitle('开始录制'))
    expect(onToggleRecording).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: '记录 (0)' }))
    const row = (await screen.findByText('录制 #7')).closest('.flex.items-center.justify-between')
    expect(row).not.toBeNull()
    const [playButton] = within(row as HTMLElement).getAllByRole('button')
    await userEvent.click(playButton)
    expect(onPlayback).toHaveBeenCalledWith('/tmp/recording-7.msshlog', '回放 #7')
    expect(screen.queryByText('录制 #7')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '记录 (1)' }))
    const deleteRow = (await screen.findByText('录制 #7')).closest('.flex.items-center.justify-between')
    const deleteButton = within(deleteRow as HTMLElement).getAllByRole('button')[1]
    await userEvent.click(deleteButton)
    await userEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(onDeleteRecording).toHaveBeenCalledWith(7))
    expect(screen.queryByText('录制 #7')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '记录 (0)' })).toBeInTheDocument()
  })

  it('shows load errors and retries to the empty state', async () => {
    const loadError = new Error('list failed')
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    listRecordings.mockRejectedValueOnce(loadError).mockResolvedValueOnce([])
    render(<SessionLog sessionId={1} isRecording onToggleRecording={vi.fn()}
      onPlayback={vi.fn()} onDeleteRecording={vi.fn(async () => {})} />)

    await userEvent.click(screen.getByRole('button', { name: '记录 (0)' }))
    expect(await screen.findByText('list failed')).toBeInTheDocument()
    expect(loggerError).toHaveBeenCalledWith('SessionLog: load recordings error:', loadError)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('暂无录制记录')).toBeInTheDocument()
  })

  it('shows an unknown label for legacy zero recording timestamps', async () => {
    listRecordings.mockResolvedValue([{ ...recording, started_at: '0001-01-01T00:00:00Z' }])
    render(<SessionLog sessionId={1} isRecording={false} onToggleRecording={vi.fn()}
      onPlayback={vi.fn()} onDeleteRecording={vi.fn(async () => {})} />)

    await userEvent.click(screen.getByRole('button', { name: '记录 (0)' }))

    expect(await screen.findByText('时间未知')).toBeInTheDocument()
    expect(screen.queryByText(/1\/1\/1/)).not.toBeInTheDocument()
  })

  it('keeps the recording count when deletion fails', async () => {
    const onDeleteRecording = vi.fn(async () => { throw new Error('delete failed') })
    render(<SessionLog sessionId={1} isRecording={false} onToggleRecording={vi.fn()}
      onPlayback={vi.fn()} onDeleteRecording={onDeleteRecording} />)
    await userEvent.click(screen.getByRole('button', { name: '记录 (0)' }))
    const row = (await screen.findByText('录制 #7')).closest('.flex.items-center.justify-between')

    await userEvent.click(within(row as HTMLElement).getAllByRole('button')[1])
    await userEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(await screen.findByText('delete failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '记录 (1)' })).toBeInTheDocument()
  })
})
