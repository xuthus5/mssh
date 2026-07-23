import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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
import { ToastContainer, useToastStore } from '@/components/ui/toast'

const recording = {
  id: 7,
  session_id: 1,
  started_at: '2026-07-13T10:00:00Z',
  ended_at: '2026-07-13T10:01:00Z',
  data_path: '/tmp/recording-7.msshlog',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('SessionLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToastStore.setState({ toasts: [] })
    listRecordings.mockResolvedValue([recording])
  })

  it('loads, plays, and removes a recording without duplicate toolbar actions', async () => {
    const onPlayback = vi.fn()
    const onClose = vi.fn()
    const onDeleteRecording = vi.fn(async () => {})
    const onDeleteDialogOpenChange = vi.fn()
    render(<SessionLog sessionId={1} onPlayback={onPlayback} onDeleteRecording={onDeleteRecording}
      onClose={onClose} onDeleteDialogOpenChange={onDeleteDialogOpenChange} />)

    expect(await screen.findByText('录制 #7')).toBeInTheDocument()
    expect(screen.queryByText('录制中')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /记录 \(/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '播放录制 #7' }))
    expect(onPlayback).toHaveBeenCalledWith('/tmp/recording-7.msshlog', '回放 #7')
    expect(onClose).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('button', { name: '删除录制 #7' }))
    expect(onDeleteDialogOpenChange).toHaveBeenLastCalledWith(true)
    await userEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(onDeleteRecording).toHaveBeenCalledWith(7))
    expect(onDeleteDialogOpenChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByText('录制 #7')).not.toBeInTheDocument()
    expect(screen.getByText('0 条')).toBeInTheDocument()
  })

  it('shows load errors and retries to the empty state', async () => {
    const loadError = new Error('list failed')
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    listRecordings.mockRejectedValueOnce(loadError).mockResolvedValueOnce([])
    render(<><SessionLog sessionId={1} onPlayback={vi.fn()} onDeleteRecording={vi.fn(async () => {})} onClose={vi.fn()} /><ToastContainer /></>)

    expect(await screen.findByText('list failed')).toBeInTheDocument()
    expect(await screen.findByText(/加载会话录制失败/)).toBeInTheDocument()
    expect(loggerError).toHaveBeenCalledWith('SessionLog: load recordings error:', loadError)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('暂无录制记录')).toBeInTheDocument()
  })

  it('shows an unknown label for invalid recording timestamps', async () => {
    listRecordings.mockResolvedValue([{ ...recording, started_at: 'not-a-date' }])
    render(<SessionLog sessionId={1} onPlayback={vi.fn()} onDeleteRecording={vi.fn(async () => {})} onClose={vi.fn()} />)

    expect(await screen.findByText('时间未知')).toBeInTheDocument()
  })

  it('keeps the recording count when deletion fails', async () => {
    const deletion = deferred<void>()
    const onDeleteRecording = vi.fn(() => deletion.promise)
    render(<><SessionLog sessionId={1} onPlayback={vi.fn()} onDeleteRecording={onDeleteRecording} onClose={vi.fn()} /><ToastContainer /></>)
    expect(await screen.findByText('录制 #7')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '删除录制 #7' }))
    await userEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByRole('button', { name: '删除中...' })).toBeDisabled()
    expect(screen.getByText('录制 #7')).toBeInTheDocument()

    deletion.reject(new Error('delete failed'))

    expect(await screen.findByText('delete failed')).toBeInTheDocument()
    expect(await screen.findByText(/删除会话录制失败/)).toBeInTheDocument()
    expect(screen.getByText('1 条')).toBeInTheDocument()
    expect(screen.getByText('录制 #7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeEnabled()
  })
})
