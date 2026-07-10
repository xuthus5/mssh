import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileTransfer } from '@/hooks/useFileTransfer'
import { setWailsServices, createLocalServices, resetWailsForTest } from '@/lib/wails'

const SESSION_ID = 1

describe('useFileTransfer', () => {
  beforeEach(() => {
    resetWailsForTest()
    setWailsServices(createLocalServices())
  })

  it('listFiles sets files from service', async () => {
    const svc = createLocalServices()
    svc.FileService.ListDir = async () => [
      { name: 'readme.md', path: '/readme.md', size: 100, is_dir: false, mod_time: '2024-01-01' },
      { name: 'src', path: '/src', size: 0, is_dir: true, mod_time: '2024-01-01' },
    ]
    resetWailsForTest()
    setWailsServices(svc)

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
    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.upload('/local/file.txt', '/remote/file.txt') })

    expect(result.current.transfers).toHaveLength(1)
    expect(result.current.transfers[0].direction).toBe('upload')
    expect(result.current.transfers[0].fileName).toBe('file.txt')
  })

  it('download creates a transfer job', async () => {
    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.download('/remote/file.txt', '/local/file.txt') })

    expect(result.current.transfers).toHaveLength(1)
    expect(result.current.transfers[0].direction).toBe('download')
    expect(result.current.transfers[0].fileName).toBe('file.txt')
  })

  it('cancelTransfer removes transfer job', async () => {
    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.upload('/a', '/b') })
    expect(result.current.transfers).toHaveLength(1)

    await act(async () => { await result.current.cancelTransfer(result.current.transfers[0].id) })
    expect(result.current.transfers).toHaveLength(0)
  })

  it('deleteFile removes from list', async () => {
    const svc = createLocalServices()
    const files = [
      { name: 'a.txt', path: '/a.txt', size: 10, is_dir: false, mod_time: '' },
      { name: 'b.txt', path: '/b.txt', size: 20, is_dir: false, mod_time: '' },
    ]
    let deleted = false
    svc.FileService.ListDir = async () => deleted ? [files[1]] : files
    svc.FileService.Delete = async () => { deleted = true }
    resetWailsForTest()
    setWailsServices(svc)

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.listFiles('/') })
    expect(result.current.files).toHaveLength(2)

    await act(async () => { await result.current.deleteFile('/a.txt') })
    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0].name).toBe('b.txt')
  })

  it('navigateUp goes to parent directory', async () => {
    const svc = createLocalServices()
    const paths: string[] = []
    svc.FileService.ListDir = async (_, path) => { paths.push(path); return [] }
    resetWailsForTest()
    setWailsServices(svc)

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.listFiles('/home/user') })
    expect(result.current.currentPath).toBe('/home/user')

    await act(async () => { result.current.navigateUp() })
    // After navigateUp, it re-lists the parent
    expect(paths).toContain('/home')
  })

  it('makeDir triggers listFiles on current path', async () => {
    const called: string[] = []
    const svc = createLocalServices()
    svc.FileService.Mkdir = async (_, p) => { called.push(p) }
    resetWailsForTest()
    setWailsServices(svc)

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.listFiles('/home') })
    await act(async () => { await result.current.makeDir('newdir') })

    expect(called).toContain('/home/newdir')
  })

  it('handles listFiles error gracefully', async () => {
    const svc = createLocalServices()
    svc.FileService.ListDir = async () => { throw new Error('permission denied') }
    resetWailsForTest()
    setWailsServices(svc)

    const { result } = renderHook(() => useFileTransfer(SESSION_ID))
    await act(async () => { await result.current.listFiles('/') })

    expect(result.current.files).toHaveLength(0)
  })
})
