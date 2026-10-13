import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostKeyPromptSync } from '@/components/layout/HostKeyPromptSync'
import { useAppStore, type Tab } from '@/store/appStore'
import { useHostKeyPromptDialog, type HostKeyPromptRequest } from '@/store/hostKeyPromptDialog'

function tab(id: string): Tab {
  return { id, title: id, type: 'terminal', terminalId: `${id}-terminal`, sessionId: 1 }
}

function promptRequest(targetTabId: string): HostKeyPromptRequest {
  return {
    coordinatorId: 1,
    prompt: {
      attemptId: `attempt-${targetTabId}`,
      hostname: 'host.internal:22',
      fingerprint: 'SHA256:key',
      algorithm: 'ssh-ed25519',
      changed: true,
      expected: [],
      targetTabId,
    },
    endpoint: { host: 'host.internal', port: 22 },
    decide: vi.fn(async () => {}),
    dismiss: vi.fn(async () => {}),
  }
}

function deferredIds() {
  return useHostKeyPromptDialog.getState().deferred.map((item) => item.prompt.attemptId)
}

describe('HostKeyPromptSync', () => {
  beforeEach(() => {
    useHostKeyPromptDialog.setState(useHostKeyPromptDialog.getInitialState())
    useAppStore.setState({ tabs: [], activeSurface: null })
  })

  afterEach(() => cleanup())

  it('tracks the active terminal tab and promotes its deferred prompt', () => {
    useAppStore.setState({ tabs: [tab('tab-1')], activeSurface: { type: 'terminal', id: 'tab-1' } })
    useHostKeyPromptDialog.setState({ deferred: [promptRequest('tab-1')] })

    render(<HostKeyPromptSync />)

    expect(useHostKeyPromptDialog.getState().activeTabId).toBe('tab-1')
    expect(useHostKeyPromptDialog.getState().active?.prompt.targetTabId).toBe('tab-1')
  })

  it('ignores workspace surfaces and prunes prompts for closed tabs', () => {
    useAppStore.setState({ tabs: [tab('tab-1')], activeSurface: { type: 'workspace', id: 'sessions' } })
    useHostKeyPromptDialog.setState({ deferred: [promptRequest('tab-1'), promptRequest('tab-gone')] })

    render(<HostKeyPromptSync />)

    expect(useHostKeyPromptDialog.getState().activeTabId).toBeNull()
    expect(deferredIds()).toEqual(['attempt-tab-1'])
  })
})
