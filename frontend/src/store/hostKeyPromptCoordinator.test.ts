import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { createHostKeyPromptCoordinator } from '@/store/hostKeyPromptCoordinator'
import { useHostKeyPromptDialog, type HostKeyPrompt } from '@/store/hostKeyPromptDialog'

const sessionService = 'github.com/xuthus5/mssh/internal/service.SessionService.'

function prompt(attemptId: string): HostKeyPrompt {
  return {
    attemptId,
    hostname: `${attemptId}.internal:22`,
    fingerprint: `SHA256:${attemptId}`,
    algorithm: 'ssh-ed25519',
  }
}

describe('HostKeyPromptCoordinator', () => {
  beforeEach(() => {
    __clearHandlers()
    __registerHandler(sessionService + 'DecideHostKey', vi.fn(async () => {}))
    __registerHandler(sessionService + 'CancelConnect', vi.fn(async () => {}))
    useHostKeyPromptDialog.setState({ active: null, pending: false, error: '' })
  })

  it('wakes a queued coordinator after another coordinator closes its prompt', async () => {
    const first = createHostKeyPromptCoordinator()
    const second = createHostKeyPromptCoordinator()
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
})
