import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationBusyError } from '@/lib/operationBusyError'
import {
  emitFileCatalogChanged,
  isFileMutationBlocked,
  onFileCatalogChanged,
  resetFileMutationCoordinator,
  runFileMutation,
  useFileMutationState,
  type FileCatalogChange,
} from '@/lib/fileMutationCoordinator'

describe('fileMutationCoordinator', () => {
  beforeEach(() => resetFileMutationCoordinator())

  it('serializes one directory while allowing independent directories', async () => {
    const pending = deferred<void>()
    const active = runFileMutation({ sessionID: 7, directoryPath: '/srv/app/' }, () => pending.promise)

    expect(isFileMutationBlocked({ sessionID: 7, directoryPath: '/srv/app' })).toBe(true)
    expect(useFileMutationState.getState().activeLeases).toHaveLength(1)
    await expect(runFileMutation({ sessionID: 7, directoryPath: '/srv//app' }, async () => {}))
      .rejects.toBeInstanceOf(OperationBusyError)
    await expect(runFileMutation({ sessionID: 7, directoryPath: '/srv/log' }, async () => 'ok')).resolves.toBe('ok')
    await expect(runFileMutation({ sessionID: 8, directoryPath: '/srv/app' }, async () => 'other')).resolves.toBe('other')

    pending.resolve()
    await active
    expect(isFileMutationBlocked({ sessionID: 7, directoryPath: '/srv/app' })).toBe(false)
  })

  it('blocks mutations beneath a directory being removed or renamed', async () => {
    const pending = deferred<void>()
    const active = runFileMutation({
      sessionID: 7,
      directoryPath: '/srv',
      subtreePath: '/srv/app',
    }, () => pending.promise)

    expect(isFileMutationBlocked({ sessionID: 7, directoryPath: '/srv/app/cache' })).toBe(true)
    expect(isFileMutationBlocked({ sessionID: 7, directoryPath: '/srv/application' })).toBe(false)
    await expect(runFileMutation({ sessionID: 7, directoryPath: '/srv/app/cache' }, async () => {}))
      .rejects.toBeInstanceOf(OperationBusyError)
    await expect(runFileMutation({ sessionID: 7, directoryPath: '/srv/application' }, async () => 'sibling'))
      .resolves.toBe('sibling')

    pending.resolve()
    await active
  })

  it('keeps POSIX backslashes as filename characters', async () => {
    const pending = deferred<void>()
    const active = runFileMutation({ sessionID: 7, directoryPath: '/srv/a\\b' }, () => pending.promise)

    await expect(runFileMutation({ sessionID: 7, directoryPath: '/srv/a/b' }, async () => 'separate'))
      .resolves.toBe('separate')

    pending.resolve()
    await active
  })

  it('notifies only other file panels for the changed session', () => {
    const source = Symbol('source')
    const sameSource = vi.fn()
    const sameSession = vi.fn()
    const otherSession = vi.fn()
    const stopSame = onFileCatalogChanged(1, source, sameSource)
    const stopSession = onFileCatalogChanged(1, Symbol('same-session'), sameSession)
    const stopOther = onFileCatalogChanged(2, Symbol('other-session'), otherSession)
    const change: FileCatalogChange = {
      sessionID: 1,
      source,
      directories: ['/srv/app'],
      removedSubtrees: ['/srv/app/cache'],
    }

    emitFileCatalogChanged(change)

    expect(sameSource).not.toHaveBeenCalled()
    expect(sameSession).toHaveBeenCalledWith(expect.objectContaining({ directories: ['/srv/app'] }))
    expect(otherSession).not.toHaveBeenCalled()
    stopSame()
    stopSession()
    stopOther()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
