import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationBusyError } from '@/lib/operationBusyError'
import {
  emitRecordingCatalogChanged,
  isRecordingMutationActive,
  onRecordingCatalogChanged,
  resetRecordingMutationCoordinator,
  runRecordingMutation,
  useRecordingMutationState,
} from '@/lib/recordingMutationCoordinator'

describe('recordingMutationCoordinator', () => {
  beforeEach(() => resetRecordingMutationCoordinator())

  it('serializes the same recording while allowing different recordings', async () => {
    const pending = deferred<void>()
    const first = runRecordingMutation(7, () => pending.promise)

    expect(isRecordingMutationActive(7)).toBe(true)
    expect(useRecordingMutationState.getState().busyRecordingIDs).toEqual(new Set([7]))
    await expect(runRecordingMutation(7, async () => {})).rejects.toBeInstanceOf(OperationBusyError)
    await expect(runRecordingMutation(8, async () => 'ok')).resolves.toBe('ok')

    pending.resolve()
    await first
    expect(isRecordingMutationActive(7)).toBe(false)
    expect(useRecordingMutationState.getState().busyRecordingIDs).toEqual(new Set())
  })

  it('notifies only other recording lists for the changed session', () => {
    const source = Symbol('source')
    const sameSource = vi.fn()
    const sameSession = vi.fn()
    const otherSession = vi.fn()
    const stopSame = onRecordingCatalogChanged(1, source, sameSource)
    const stopSession = onRecordingCatalogChanged(1, Symbol('same-session'), sameSession)
    const stopOther = onRecordingCatalogChanged(2, Symbol('other-session'), otherSession)

    emitRecordingCatalogChanged(1, source)

    expect(sameSource).not.toHaveBeenCalled()
    expect(sameSession).toHaveBeenCalledOnce()
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
