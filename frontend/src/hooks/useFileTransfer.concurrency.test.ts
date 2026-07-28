import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileTransfer } from '@/hooks/useFileTransfer'
import { OperationBusyError } from '@/lib/operationBusyError'
import { resetFileMutationCoordinator } from '@/lib/fileMutationCoordinator'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

describe('useFileTransfer cross-panel mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearHandlers()
    resetFileMutationCoordinator()
    useAppStore.setState({ transfers: [], transferCenterOpen: false, tabs: [] })
  })

  it('shares a directory mutation lease across panels', async () => {
    const deletion = deferred<void>()
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Delete', async () => deletion.promise)
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Rename', async () => undefined)
    const view = renderHook(() => ({ first: useFileTransfer(1), second: useFileTransfer(1) }))
    await act(async () => {
      await view.result.current.first.listFiles('/srv/app')
      await view.result.current.second.listFiles('/srv/app')
    })

    let activeDelete!: Promise<void>
    act(() => { activeDelete = view.result.current.first.deleteFile('/srv/app/a.txt') })
    await waitFor(() => expect(view.result.current.second.directoryMutationBusy).toBe(true))
    await expect(view.result.current.second.renameFile('/srv/app/b.txt', 'c.txt'))
      .rejects.toBeInstanceOf(OperationBusyError)

    deletion.resolve()
    await act(async () => { await activeDelete })
    expect(view.result.current.second.directoryMutationBusy).toBe(false)
  })

  it('keeps independent remote directories parallel', async () => {
    const deletion = deferred<void>()
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Delete', async () => deletion.promise)
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Mkdir', async () => undefined)
    const view = renderHook(() => ({ first: useFileTransfer(1), second: useFileTransfer(1) }))
    await act(async () => {
      await view.result.current.first.listFiles('/srv/app')
      await view.result.current.second.listFiles('/srv/log')
    })

    let activeDelete!: Promise<void>
    act(() => { activeDelete = view.result.current.first.deleteFile('/srv/app/a.txt') })
    await expect(view.result.current.second.makeDir('archive')).resolves.toBeUndefined()

    deletion.resolve()
    await act(async () => { await activeDelete })
  })

  it('blocks transfer starts that target a directory under mutation', async () => {
    const deletion = deferred<void>()
    const upload = vi.fn(async () => 'upload-1')
    const download = vi.fn(async () => 'download-1')
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Delete', async () => deletion.promise)
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Upload', upload)
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Download', download)
    const view = renderHook(() => ({ first: useFileTransfer(1), second: useFileTransfer(1) }))
    await act(async () => {
      await view.result.current.first.listFiles('/srv/app')
      await view.result.current.second.listFiles('/srv/app')
    })

    let activeDelete!: Promise<void>
    act(() => { activeDelete = view.result.current.first.deleteFile('/srv/app/a.txt') })
    await expect(view.result.current.second.upload('/tmp/new.txt', '/srv/app')).rejects.toBeInstanceOf(OperationBusyError)
    await expect(view.result.current.second.download('/srv/app/b.txt', '/tmp/b.txt')).rejects.toBeInstanceOf(OperationBusyError)
    expect(upload).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()

    deletion.resolve()
    await act(async () => { await activeDelete })
  })

  it('refreshes another panel after a successful mutation', async () => {
    let files = [{ name: 'a.txt', path: '/srv/app/a.txt', size: 1, is_dir: false, mod_time: '' }]
    let listCalls = 0
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async () => {
      listCalls++
      return files
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Delete', async () => { files = [] })
    const view = renderHook(() => ({ first: useFileTransfer(1), second: useFileTransfer(1) }))
    await act(async () => {
      await view.result.current.first.listFiles('/srv/app')
      await view.result.current.second.listFiles('/srv/app')
    })

    await act(async () => { await view.result.current.first.deleteFile('/srv/app/a.txt') })

    await waitFor(() => expect(view.result.current.second.files).toEqual([]))
    expect(listCalls).toBeGreaterThanOrEqual(4)
    expect(view.result.current.second.catalogRevision).toBeGreaterThan(0)
  })

  it('moves or exits panels whose active directory changed structurally', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListDir', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Rename', async () => undefined)
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Delete', async () => undefined)
    const view = renderHook(() => ({ owner: useFileTransfer(1), nested: useFileTransfer(1) }))
    await act(async () => {
      await view.result.current.owner.listFiles('/srv')
      await view.result.current.nested.listFiles('/srv/app/cache')
    })

    await act(async () => { await view.result.current.owner.renameFile('/srv/app', 'renamed', true) })
    await waitFor(() => expect(view.result.current.nested.currentPath).toBe('/srv/renamed/cache'))

    await act(async () => { await view.result.current.owner.deleteFile('/srv/renamed', true) })
    await waitFor(() => expect(view.result.current.nested.currentPath).toBe('/srv'))
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
