import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useHostKeyPromptDialog,
  type HostKeyPrompt,
  type HostKeyPromptRequest,
} from '@/store/hostKeyPromptDialog'

function request(attemptId: string, targetTabId?: string | null): HostKeyPromptRequest {
  const prompt: HostKeyPrompt = {
    attemptId,
    hostname: `${attemptId}.internal:22`,
    fingerprint: `SHA256:${attemptId}`,
    algorithm: 'ssh-ed25519',
    changed: false,
    expected: [],
    targetTabId,
  }
  return {
    coordinatorId: 1,
    prompt,
    endpoint: { host: `${attemptId}.internal`, port: 22 },
    decide: vi.fn(async () => {}),
    dismiss: vi.fn(async () => {}),
  }
}

function deferredIds() {
  return useHostKeyPromptDialog.getState().deferred.map((item) => item.prompt.attemptId)
}

describe('useHostKeyPromptDialog tab-aware deferral', () => {
  beforeEach(() => {
    useHostKeyPromptDialog.setState(useHostKeyPromptDialog.getInitialState())
  })

  it('shows global prompts immediately and defers prompts for background tabs', () => {
    expect(useHostKeyPromptDialog.getState().present(request('global'))).toBe(true)
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('global')

    expect(useHostKeyPromptDialog.getState().present(request('background', 'tab-b'))).toBe(true)
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('global')
    expect(deferredIds()).toEqual(['background'])

    expect(useHostKeyPromptDialog.getState().hasAttempt('background')).toBe(true)
    expect(useHostKeyPromptDialog.getState().hasAttempt('missing')).toBe(false)
  })

  it('shows a background prompt as soon as its tab becomes active', () => {
    useHostKeyPromptDialog.getState().present(request('background', 'tab-b'))

    useHostKeyPromptDialog.getState().setActiveTabId('tab-b')

    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('background')
    expect(deferredIds()).toEqual([])
  })

  it('demotes an active prompt when the user leaves its tab', () => {
    useHostKeyPromptDialog.getState().setActiveTabId('tab-a')
    useHostKeyPromptDialog.getState().present(request('scoped', 'tab-a'))
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('scoped')

    useHostKeyPromptDialog.getState().setActiveTabId('tab-b')

    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    expect(deferredIds()).toEqual(['scoped'])

    useHostKeyPromptDialog.getState().setActiveTabId('tab-a')
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('scoped')
  })

  it('drops deferred prompts for closed tabs and cleared coordinators', () => {
    useHostKeyPromptDialog.getState().present(request('kept', 'tab-a'))
    useHostKeyPromptDialog.getState().present(request('closed', 'tab-z'))

    useHostKeyPromptDialog.getState().pruneTabs(['tab-a'])
    expect(deferredIds()).toEqual(['kept'])

    useHostKeyPromptDialog.getState().clear(1)
    expect(deferredIds()).toEqual([])
  })

  it('removes a finished attempt only when owned by the requesting coordinator', () => {
    useHostKeyPromptDialog.getState().present(request('owned', 'tab-a'))

    useHostKeyPromptDialog.getState().finishAttempt('owned', 2)
    expect(deferredIds()).toEqual(['owned'])

    useHostKeyPromptDialog.getState().finishAttempt('owned', 1)
    expect(deferredIds()).toEqual([])
  })

  it('ignores duplicate attempts already active or deferred', () => {
    useHostKeyPromptDialog.getState().setActiveTabId('tab-a')
    useHostKeyPromptDialog.getState().present(request('dup', 'tab-a'))
    useHostKeyPromptDialog.getState().present(request('deferred', 'tab-b'))

    expect(useHostKeyPromptDialog.getState().present(request('dup', 'tab-a'))).toBe(false)
    expect(useHostKeyPromptDialog.getState().present(request('deferred', 'tab-b'))).toBe(false)
  })

  it('promotes the next visible prompt after deciding the active one', async () => {
    useHostKeyPromptDialog.getState().setActiveTabId('tab-a')
    useHostKeyPromptDialog.getState().present(request('background', 'tab-b'))
    useHostKeyPromptDialog.getState().present(request('foreground', 'tab-a'))

    await useHostKeyPromptDialog.getState().decide(true)

    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    useHostKeyPromptDialog.getState().setActiveTabId('tab-b')
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('background')
  })
})
