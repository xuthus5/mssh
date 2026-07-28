import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationBusyError } from '@/lib/operationBusyError'
import {
  emitMacroCatalogChanged,
  isMacroMutationActive,
  onMacroCatalogChanged,
  resetMacroMutationCoordinator,
  runMacroMutation,
  useMacroMutationState,
} from '@/lib/macroMutationCoordinator'

describe('macroMutationCoordinator', () => {
  beforeEach(() => resetMacroMutationCoordinator())

  it('rejects overlapping mutations and exposes the shared busy state', async () => {
    const pending = deferred<void>()
    const first = runMacroMutation(() => pending.promise)
    expect(isMacroMutationActive()).toBe(true)
    expect(useMacroMutationState.getState().busy).toBe(true)

    await expect(runMacroMutation(async () => {})).rejects.toBeInstanceOf(OperationBusyError)
    pending.resolve()
    await first
    expect(isMacroMutationActive()).toBe(false)
    expect(useMacroMutationState.getState().busy).toBe(false)
  })

  it('notifies other catalog consumers without echoing to the source', () => {
    const source = Symbol('source')
    const sameSource = vi.fn()
    const otherSource = vi.fn()
    const stopSame = onMacroCatalogChanged(source, sameSource)
    const stopOther = onMacroCatalogChanged(Symbol('other'), otherSource)

    emitMacroCatalogChanged(source)
    expect(sameSource).not.toHaveBeenCalled()
    expect(otherSource).toHaveBeenCalledOnce()
    stopSame()
    stopOther()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
