import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileTransfer } from '@/hooks/useFileTransfer'
import { __registerHandler, __clearHandlers } from '@/test/__mocks__/wails-runtime'
import { useAppStore } from '@/store/appStore'
import { useToastStore } from '@/components/ui/toast'
import { logger } from '@/lib/logger'

const SESSION_ID = 1

describe('useFileTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearHandlers()
    useToastStore.setState({ toasts: [] })
    useAppStore.setState({ transfers: [], transferCenterOpen: false, tabs: [{ id: 'tab-1', title: '生产服务器', type: 'terminal', terminalId: 'term-1', sessionId: SESSION_ID }] })
  })

  it('listFiles sets files from service', async () => {
    const files = [
      { name: 'readme.md', path: '/readme.md', size: 100, is_dir: false, mod_time: '2024-01-01' },
      { name: 'src', path: '/src', size: 0, is_dir: true, mod_time: '2024-01-01' },
    ]
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async () => files)

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.listFiles('/') })

    expect(result.current.files).toHaveLength(2)
    expect(result.current.files[0].name).toBe('readme.md')
    expect(result.current.files[0].isDir).toBe(false)
    expect(result.current.files[1].name).toBe('src')
    expect(result.current.files[1].isDir).toBe(true)
    expect(result.current.currentPath).toBe('/')
  })

  it('upload creates a transfer job', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Upload', async () => 'task-1')

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.upload('/local/file.txt', '/remote/file.txt') })

    expect(result.current.transfers).toHaveLength(1)
    expect(result.current.transfers[0].direction).toBe('upload')
    expect(result.current.transfers[0].fileName).toBe('file.txt')
    expect(result.current.transfers[0]).toMatchObject({ sessionId: SESSION_ID, sessionName: '生产服务器', sourcePath: '/local/file.txt', targetPath: '/remote/file.txt/file.txt' })
    expect(useAppStore.getState().transferCenterOpen).toBe(true)
  })

  it('uploads every dropped file to the current remote directory', async () => {
    const uploads: string[] = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Upload', async (_sessionID: number, localPath: string) => {
      uploads.push(localPath)
      return `task-${uploads.length}`
    })
    const { result } = renderHook(() => useFileTransfer(SESSION_ID))

    await act(async () => { await result.current.uploadMany(['/tmp/a.txt', '/tmp/b.txt'], '/remote') })

    expect(uploads).toEqual(['/tmp/a.txt', '/tmp/b.txt'])
    expect(result.current.transfers).toHaveLength(2)
  })

  it('download creates a transfer job', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Download', async () => 'task-2')

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.download('/remote/file.txt', '/local/file.txt') })

    expect(result.current.transfers).toHaveLength(1)
    expect(result.current.transfers[0].direction).toBe('download')
    expect(result.current.transfers[0].fileName).toBe('file.txt')
    expect(result.current.transfers[0]).toMatchObject({ sourcePath: '/remote/file.txt', targetPath: '/local/file.txt' })
  })

  it('cancelTransfer requests cancellation and keeps terminal state visible', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Upload', async () => 'task-1')
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.CancelTransfer', async () => {})

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.upload('/a', '/b') })
    expect(result.current.transfers).toHaveLength(1)

    await act(async () => { await result.current.cancelTransfer(result.current.transfers[0].id) })
    expect(result.current.transfers).toHaveLength(1)
    expect(result.current.transfers[0].status).toBe('queued')
  })

  it('deleteFile removes from list', async () => {
    const files = [
      { name: 'a.txt', path: '/a.txt', size: 10, is_dir: false, mod_time: '' },
      { name: 'b.txt', path: '/b.txt', size: 20, is_dir: false, mod_time: '' },
    ]
    let deleted = false
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async () => deleted ? [files[1]] : files)
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Delete', async () => { deleted = true })

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.listFiles('/') })
    expect(result.current.files).toHaveLength(2)

    await act(async () => { await result.current.deleteFile('/a.txt') })
    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0].name).toBe('b.txt')
  })

  it('navigateUp goes to parent directory', async () => {
    const paths: string[] = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async (_sid: number, path: string) => {
      paths.push(path)
      return []
    })

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.listFiles('/home/user') })
    expect(result.current.currentPath).toBe('/home/user')

    await act(async () => { result.current.navigateUp() })
    expect(paths).toContain('/home')
  })

  it('navigates directly and ignores stale directory responses', async () => {
    let resolveSlow!: (files: never[]) => void
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async (_sid: number, path: string) => {
      if (path === '/slow') return new Promise<never[]>((resolve) => { resolveSlow = resolve })
      return [{ name: 'fast', path: '/fast/file', size: 1, is_dir: false, mod_time: '' }]
    })
    const { result } = renderHook(() => useFileTransfer(SESSION_ID))

    act(() => { result.current.navigateTo('/slow') })
    await act(async () => { await result.current.listFiles('/fast') })
    await act(async () => { resolveSlow([]) })

    expect(result.current.currentPath).toBe('/fast')
    expect(result.current.files[0].name).toBe('fast')
    expect(result.current.loading).toBe(false)
  })

  it('makeDir triggers listFiles on current path', async () => {
    const called: string[] = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Mkdir', async (_sid: number, p: string) => { called.push(p) })

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.listFiles('/home') })
    await act(async () => { await result.current.makeDir('newdir') })

    expect(called).toContain('/home/newdir')
  })

  it('renames files and refreshes the current directory', async () => {
    const renames: unknown[][] = []
    const listed: string[] = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async (_sid: number, path: string) => {
      listed.push(path)
      return []
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Rename', async (...args: unknown[]) => {
      renames.push(args)
    })
    const { result } = renderHook(() => useFileTransfer(SESSION_ID))

    await act(async () => { await result.current.listFiles('/home') })
    await act(async () => { await result.current.renameFile('/home/old.txt', 'new.txt') })

    expect(renames).toEqual([[SESSION_ID, '/home/old.txt', 'new.txt']])
    expect(listed).toEqual(['/home', '/home'])
  })

  it('reports upload and download failures without creating transfers', async () => {
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Upload', async () => { throw new Error('upload denied') })
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Download', async () => { throw new Error('download denied') })
    const { result } = renderHook(() => useFileTransfer(SESSION_ID))

    await act(async () => {
      await result.current.upload('/local/a.txt', '/remote')
      await result.current.download('/remote/b.txt', '/local/b.txt')
    })

    expect(result.current.transfers).toHaveLength(0)
    expect(useToastStore.getState().toasts.map((item) => item.message)).toEqual([
      '上传失败: upload denied',
      '下载失败: download denied',
    ])
    expect(loggerError).toHaveBeenCalledWith('upload error', expect.any(Error))
    expect(loggerError).toHaveBeenCalledWith('download error', expect.any(Error))
  })

  it('handles listFiles error gracefully', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async () => { throw new Error('permission denied') })

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.listFiles('/') })

    expect(result.current.files).toHaveLength(0)
  })
})
