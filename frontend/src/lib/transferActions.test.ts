import { beforeEach, describe, expect, it } from 'vitest'
import { cancelTransfer, retryTransfer, startDownload, startUpload } from '@/lib/transferActions'
import { useAppStore, type TransferJob } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

describe('transferActions', () => {
  beforeEach(() => {
    __clearHandlers()
    useAppStore.setState({ transfers: [], transferCenterOpen: false })
  })

  it('starts upload and download jobs with retry metadata', async () => {
    const calls: unknown[][] = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Upload', async (...args: unknown[]) => { calls.push(args); return 'upload-1' })
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Download', async (...args: unknown[]) => { calls.push(args); return 'download-1' })

    await startUpload({ sessionId: 7, sessionName: '生产服务器', sourcePath: '/tmp/app.tar.gz', targetPath: '/srv/app.tar.gz' })
    await startDownload({ sessionId: 7, sessionName: '生产服务器', sourcePath: '/srv/log.txt', targetPath: '/tmp/log.txt' })

    expect(calls).toEqual([[7, '/tmp/app.tar.gz', '/srv/app.tar.gz'], [7, '/srv/log.txt', '/tmp/log.txt']])
    expect(useAppStore.getState().transfers).toMatchObject([
      { id: 'upload-1', fileName: 'app.tar.gz', direction: 'upload', sourcePath: '/tmp/app.tar.gz', targetPath: '/srv/app.tar.gz' },
      { id: 'download-1', fileName: 'log.txt', direction: 'download', sourcePath: '/srv/log.txt', targetPath: '/tmp/log.txt' },
    ])
    expect(useAppStore.getState().transferCenterOpen).toBe(true)
  })

  it('retries failed transfer with the original direction and replaces history', async () => {
    const failed: TransferJob = { id: 'failed-1', fileName: 'app.tar.gz', direction: 'upload', sessionId: 7, sessionName: '生产服务器', sourcePath: '/tmp/app.tar.gz', targetPath: '/srv/app.tar.gz', totalBytes: 100, transferredBytes: 50, speed: 0, eta: 0, status: 'failed', error: 'denied', startedAt: 1, completedAt: 2 }
    useAppStore.setState({ transfers: [failed] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Upload', async () => 'retry-1')

    await retryTransfer(failed)

    expect(useAppStore.getState().transfers).toMatchObject([{ id: 'retry-1', status: 'queued', transferredBytes: 0 }])
  })

  it('requests cancellation without prematurely removing the task', async () => {
    let cancelled = ''
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.CancelTransfer', async (id: string) => { cancelled = id })
    useAppStore.setState({ transfers: [{ id: 'running-1' } as TransferJob] })

    await cancelTransfer('running-1')

    expect(cancelled).toBe('running-1')
    expect(useAppStore.getState().transfers).toHaveLength(1)
  })

  it('refuses retry for session-deleted transfers', async () => {
    const cancelled: TransferJob = {
      id: 'c1', fileName: 'a.txt', direction: 'upload', sessionId: 9, sessionName: 'gone',
      sourcePath: '/a', targetPath: '/b', totalBytes: 1, transferredBytes: 0, speed: 0, eta: 0,
      status: 'cancelled', error: '会话已删除', startedAt: 1, completedAt: 2,
    }
    await expect(retryTransfer(cancelled)).rejects.toThrow('会话已删除，无法重试传输')
    expect(useAppStore.getState().transfers).toEqual([])
  })
})
