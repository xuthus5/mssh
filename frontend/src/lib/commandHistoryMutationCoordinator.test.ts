import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationBusyError } from '@/lib/operationBusyError'
import {
  emitCommandHistoryChanged,
  isCommandHistoryMutationActive,
  onCommandHistoryChanged,
  resetCommandHistoryMutationCoordinator,
  runCommandHistoryMutation,
  useCommandHistoryMutationState,
} from '@/lib/commandHistoryMutationCoordinator'

describe('commandHistoryMutationCoordinator', () => {
  beforeEach(() => resetCommandHistoryMutationCoordinator())

  it('serializes clears per session while allowing different sessions', async () => {
    const pending = deferred<void>()
    const first = runCommandHistoryMutation(7, () => pending.promise)

    expect(isCommandHistoryMutationActive(7)).toBe(true)
    expect(useCommandHistoryMutationState.getState().busySessionIDs).toEqual(new Set([7]))
    await expect(runCommandHistoryMutation(7, async () => {})).rejects.toBeInstanceOf(OperationBusyError)
    await expect(runCommandHistoryMutation(8, async () => 'ok')).resolves.toBe('ok')

    pending.resolve()
    await first
    expect(isCommandHistoryMutationActive(7)).toBe(false)
    expect(useCommandHistoryMutationState.getState().busySessionIDs).toEqual(new Set())
  })

  it('notifies only other history panels for the changed session', () => {
    const source = Symbol('source')
    const sameSource = vi.fn()
    const sameSession = vi.fn()
    const otherSession = vi.fn()
    const stopSame = onCommandHistoryChanged(1, source, sameSource)
    const stopSession = onCommandHistoryChanged(1, Symbol('same-session'), sameSession)
    const stopOther = onCommandHistoryChanged(2, Symbol('other-session'), otherSession)

    emitCommandHistoryChanged(1, source)

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
