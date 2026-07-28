import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileTransfer } from '@/hooks/useFileTransfer'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

describe('useFileTransfer upload batches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearHandlers()
    useAppStore.setState({
      transfers: [], transferCenterOpen: false,
      tabs: [{ id: 'tab-1', title: 'server', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
    })
  })

  it('waits for every start request and reports partial queue failures', async () => {
    const delayed = deferred<string>()
    const upload = vi.fn(async (_sessionID: number, localPath: string) => {
      if (localPath.endsWith('a.txt')) throw new Error('queue full')
      return delayed.promise
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.Upload', upload)
    const { result } = renderHook(() => useFileTransfer(1))

    let settled = false
    let batch!: Promise<void>
    act(() => {
      batch = result.current.uploadMany(['/tmp/a.txt', '/tmp/b.txt'], '/remote')
      void batch.finally(() => { settled = true }).catch(() => undefined)
    })
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    expect(settled).toBe(false)

    delayed.resolve('task-b')
    await expect(batch).rejects.toThrow('1 个文件未能加入传输队列: queue full')
    expect(useAppStore.getState().transfers).toEqual([
      expect.objectContaining({ id: 'task-b', fileName: 'b.txt' }),
    ])
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
