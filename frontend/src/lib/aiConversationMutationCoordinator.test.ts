import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationBusyError } from '@/lib/operationBusyError'
import {
  emitAIConversationChanged,
  onAIConversationChanged,
  resetAIConversationMutationCoordinator,
  runAIConversationMutation,
  useAIConversationMutationState,
} from '@/lib/aiConversationMutationCoordinator'

describe('aiConversationMutationCoordinator', () => {
  beforeEach(() => resetAIConversationMutationCoordinator())

  it('serializes an existing conversation while allowing independent conversations', async () => {
    const pending = deferred<void>()
    const active = runAIConversationMutation(7, () => pending.promise)

    expect(useAIConversationMutationState.getState().busyConversationIDs).toEqual(new Set([7]))
    await expect(runAIConversationMutation(7, async () => {})).rejects.toBeInstanceOf(OperationBusyError)
    await expect(runAIConversationMutation(8, async () => 'other')).resolves.toBe('other')

    pending.resolve()
    await active
    expect(useAIConversationMutationState.getState().busyConversationIDs).toEqual(new Set())
  })

  it('does not serialize new conversations before they have an id', async () => {
    const first = deferred<void>()
    const active = runAIConversationMutation(0, () => first.promise)

    await expect(runAIConversationMutation(0, async () => 'new')).resolves.toBe('new')

    first.resolve()
    await active
  })

  it('notifies only other AI panels for the changed session', () => {
    const source = Symbol('source')
    const sameSource = vi.fn()
    const sameSession = vi.fn()
    const otherSession = vi.fn()
    const stopSame = onAIConversationChanged(1, source, sameSource)
    const stopSession = onAIConversationChanged(1, Symbol('same-session'), sameSession)
    const stopOther = onAIConversationChanged(2, Symbol('other-session'), otherSession)

    emitAIConversationChanged(1, 7, source)

    expect(sameSource).not.toHaveBeenCalled()
    expect(sameSession).toHaveBeenCalledWith(7)
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
