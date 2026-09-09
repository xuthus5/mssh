import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { createHostKeyPromptCoordinator } from '@/store/hostKeyPromptCoordinator'
import { useHostKeyPromptDialog, type HostKeyPrompt } from '@/store/hostKeyPromptDialog'

const sessionService = 'github.com/xuthus5/mssh/internal/service.SessionService.'
let coordinators: ReturnType<typeof createHostKeyPromptCoordinator>[] = []

function coordinator() {
  const instance = createHostKeyPromptCoordinator()
  coordinators.push(instance)
  return instance
}

function prompt(attemptId: string): HostKeyPrompt {
  return {
    attemptId,
    hostname: `${attemptId}.internal:22`,
    fingerprint: `SHA256:${attemptId}`,
    algorithm: 'ssh-ed25519',
    changed: false,
    expected: [],
  }
}

describe('HostKeyPromptCoordinator', () => {
  beforeEach(() => {
    __clearHandlers()
    __registerHandler(sessionService + 'DecideHostKey', vi.fn(async () => {}))
    __registerHandler(sessionService + 'CancelConnect', vi.fn(async () => {}))
    useHostKeyPromptDialog.setState({ active: null, pending: false, error: '' })
  })

  afterEach(() => {
    for (const instance of coordinators) instance.stop()
    coordinators = []
  })

  it('wakes a queued coordinator after another coordinator closes its prompt', async () => {
    const first = coordinator()
    const second = coordinator()
    first.handle(prompt('first'))
    second.handle(prompt('second'))

    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('first')
    await useHostKeyPromptDialog.getState().decide(true)

    await waitFor(() => {
      expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('second')
    })
    first.stop()
    second.stop()
  })

  it('removes a finished active attempt and wakes the next prompt without deciding it', async () => {
    const decide = vi.fn(async () => {})
    __registerHandler(sessionService + 'DecideHostKey', decide)
    const instance = coordinator()
    instance.handle(prompt('first'))
    instance.handle(prompt('second'))

    instance.finish('first')

    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    await waitFor(() => expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('second'))
    expect(decide).not.toHaveBeenCalled()
  })

  it('prunes a finished queued attempt while preserving the active and remaining requests', async () => {
    const instance = coordinator()
    instance.handle(prompt('first'))
    instance.handle(prompt('second'))
    instance.handle(prompt('third'))

    instance.finish('second')
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('first')
    await useHostKeyPromptDialog.getState().decide(true)

    await waitFor(() => expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('third'))
  })

  it('does not clear an active prompt owned by another coordinator', () => {
    const first = coordinator()
    const second = coordinator()
    first.handle(prompt('shared'))

    second.finish('shared')
    second.finish('unrelated')

    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('shared')
  })

  it('ignores fingerprints delivered after their attempt finished', () => {
    const decide = vi.fn(async () => {})
    __registerHandler(sessionService + 'DecideHostKey', decide)
    const instance = coordinator()

    instance.finish('late')
    instance.handle(prompt('late'))

    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    expect(decide).not.toHaveBeenCalled()
  })

  it('does not let a late decision failure overwrite the next prompt', async () => {
    let reject!: (reason: Error) => void
    __registerHandler(sessionService + 'DecideHostKey', () => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise }))
    const instance = coordinator()
    instance.handle(prompt('first'))
    instance.handle(prompt('second'))
    const decision = useHostKeyPromptDialog.getState().decide(true)
    instance.finish('first')
    await waitFor(() => expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('second'))

    reject(new Error('expired attempt'))
    await decision

    expect(useHostKeyPromptDialog.getState()).toMatchObject({
      active: { prompt: { attemptId: 'second' } }, pending: false, error: '',
    })
    instance.finish('second')
  })

  it('bounds finished attempt history during sustained connection churn', () => {
    const instance = coordinator()
    const attemptCount = 1024
    for (let index = 0; index < attemptCount; index++) instance.finish(`finished-${index}`)

    instance.handle(prompt(`finished-${attemptCount - 1}`))
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    instance.handle(prompt('finished-0'))
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('finished-0')
  })

  it('ignores empty completion IDs and completion calls after stop', () => {
    const instance = coordinator()
    instance.handle(prompt('active'))
    instance.finish('')
    instance.finish('   ')
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('active')
    instance.stop()

    const current = coordinator()
    current.handle(prompt('active'))
    instance.finish('active')

    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('active')
  })
})
