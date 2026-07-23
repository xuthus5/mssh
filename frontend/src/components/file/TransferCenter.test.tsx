import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { TransferCenter } from '@/components/file/TransferCenter'
import { useAppStore, type TransferJob } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const baseJob = { sessionId: 1, sessionName: '生产服务器', sourcePath: '/local/file', targetPath: '/remote/file', totalBytes: 100, transferredBytes: 50, speed: 1024, eta: 12, startedAt: 1 } as const

describe('TransferCenter', () => {
  beforeEach(() => {
    __clearHandlers()
    useAppStore.setState({ transfers: [], transfersLoadError: '', transferCenterOpen: false })
  })

  it('shows aggregate status and opens the sheet', async () => {
    useAppStore.setState({ transfers: [
      { ...baseJob, id: 'one', fileName: 'one.zip', direction: 'upload', status: 'running' },
      { ...baseJob, id: 'two', fileName: 'two.zip', direction: 'download', status: 'running' },
    ] })
    render(<TransferCenter />)

    const trigger = screen.getByRole('button', { name: '打开传输中心，2 个活动任务，50%' })
    await userEvent.click(trigger)

    expect(useAppStore.getState().transferCenterOpen).toBe(true)
    expect(screen.getByRole('heading', { name: '传输中心' })).toBeInTheDocument()
  })

  it('renders active and recent tasks and clears only history', async () => {
    useAppStore.setState({ transferCenterOpen: true, transfers: [
      { ...baseJob, id: 'running', fileName: 'app.tar.gz', direction: 'upload', status: 'running' },
      { ...baseJob, id: 'failed', fileName: 'backup.sql', direction: 'download', status: 'failed', error: 'permission denied', completedAt: 2 },
    ] })
    render(<TransferCenter />)

    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('最近完成')).toBeInTheDocument()
    expect(screen.getAllByText('生产服务器')).toHaveLength(2)
    expect(screen.getByText('permission denied')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '清除记录' }))
    expect(useAppStore.getState().transfers.map((item) => item.id)).toEqual(['running'])
  })

  it('cancels an active task, retries a failed task and removes history', async () => {
    const running = { ...baseJob, id: 'running', fileName: 'app.tar.gz', direction: 'upload', status: 'running' } satisfies TransferJob
    const failed = { ...baseJob, id: 'failed', fileName: 'backup.sql', direction: 'download', sourcePath: '/remote/backup.sql', targetPath: '/local/backup.sql', status: 'failed', error: 'denied', completedAt: 2 } satisfies TransferJob
    useAppStore.setState({ transferCenterOpen: true, transfers: [running, failed] })
    let cancelled = ''
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.CancelTransfer', async (id: string) => { cancelled = id })
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Download', async () => 'retry-1')
    render(<TransferCenter />)

    await userEvent.click(screen.getByRole('button', { name: '取消 app.tar.gz' }))
    expect(cancelled).toBe('running')
    await userEvent.click(screen.getByRole('button', { name: '重试 backup.sql' }))
    await waitFor(() => expect(useAppStore.getState().transfers.some((item) => item.id === 'retry-1')).toBe(true))

    act(() => useAppStore.getState().updateTransfer('retry-1', { status: 'failed', completedAt: 3 }))
    await userEvent.click(await screen.findByRole('button', { name: '移除 backup.sql' }))
    expect(useAppStore.getState().transfers.some((item) => item.id === 'retry-1')).toBe(false)
  })
})

  it('shows restore failure instead of empty list and allows retry', async () => {
    useAppStore.setState({ transferCenterOpen: true, transfers: [], transfersLoadError: 'list transfers failed' })
    let calls = 0
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListTransfers', async () => {
      calls += 1
      return [{ id: 'saved', session_id: 3, session_name: 'server', direction: 'upload', source_path: '/tmp/a.txt', target_path: '/a.txt', total_bytes: 10, transferred_bytes: 10, speed: 2, eta: 0, status: 'completed', error: '', started_at: '2026-07-17T00:00:00Z', completed_at: '2026-07-17T00:00:05Z' }]
    })
    render(<TransferCenter />)
    expect(screen.queryByText('暂无传输任务')).not.toBeInTheDocument()
    expect(screen.getByText(/恢复传输记录失败/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(useAppStore.getState().transfersLoadError).toBe(''))
    expect(calls).toBe(1)
    expect(useAppStore.getState().transfers[0]).toMatchObject({ id: 'saved' })
  })

  it('shows transfer trigger when only load error is present', () => {
    useAppStore.setState({ transfers: [], transfersLoadError: 'boom', transferCenterOpen: false })
    render(<TransferCenter />)
    expect(screen.getByRole('button', { name: '打开传输中心，传输记录加载失败' })).toBeInTheDocument()
  })
