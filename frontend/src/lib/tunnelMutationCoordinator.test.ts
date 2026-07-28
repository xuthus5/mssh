import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationBusyError } from '@/lib/operationBusyError'
import {
  emitTunnelCatalogChanged,
  isTunnelMutationActive,
  onTunnelCatalogChanged,
  resetTunnelMutationCoordinator,
  runTunnelMutation,
  useTunnelMutationState,
} from '@/lib/tunnelMutationCoordinator'

describe('tunnelMutationCoordinator', () => {
  beforeEach(() => resetTunnelMutationCoordinator())

  it('serializes the same session while allowing different sessions', async () => {
    const pending = deferred<void>()
    const first = runTunnelMutation(7, () => pending.promise)

    expect(isTunnelMutationActive('7')).toBe(true)
    expect(useTunnelMutationState.getState().busySessions).toEqual(new Set(['7']))
    await expect(runTunnelMutation('7', async () => {})).rejects.toBeInstanceOf(OperationBusyError)
    await expect(runTunnelMutation('8', async () => 'ok')).resolves.toBe('ok')

    pending.resolve()
    await first
    expect(isTunnelMutationActive(7)).toBe(false)
    expect(useTunnelMutationState.getState().busySessions).toEqual(new Set())
  })

  it('notifies only other consumers of the changed session', () => {
    const source = Symbol('source')
    const sameSource = vi.fn()
    const sameSession = vi.fn()
    const otherSession = vi.fn()
    const stopSame = onTunnelCatalogChanged(7, source, sameSource)
    const stopSession = onTunnelCatalogChanged('7', Symbol('same-session'), sameSession)
    const stopOther = onTunnelCatalogChanged(8, Symbol('other-session'), otherSession)

    emitTunnelCatalogChanged('7', source)

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
