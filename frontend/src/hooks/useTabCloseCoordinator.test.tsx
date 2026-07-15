import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTabCloseCoordinator } from '@/hooks/useTabCloseCoordinator'
import { useAppStore } from '@/store/appStore'

describe('useTabCloseCoordinator', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [],
      connectionStatus: {},
      recordingState: {},
      closeTab: vi.fn(async () => {}),
    })
  })

  it('cancels a pending active connection close', () => {
    const closeTab = vi.fn(async () => {})
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      connectionStatus: { 'term-1': 'connected' },
      closeTab,
    })
    const hook = renderHook(() => useTabCloseCoordinator())

    act(() => hook.result.current.requestClose('terminal-1'))
    expect(hook.result.current.confirmation.pendingTabID).toBe('terminal-1')
    act(() => hook.result.current.confirmation.onCancel())

    expect(hook.result.current.confirmation.pendingTabID).toBeNull()
    expect(closeTab).not.toHaveBeenCalled()
  })

  it('confirms an active recording close', async () => {
    const closeTab = vi.fn(async () => {})
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      recordingState: { 'term-1': 'recording' },
      closeTab,
    })
    const hook = renderHook(() => useTabCloseCoordinator())

    act(() => hook.result.current.requestClose('terminal-1'))
    act(() => hook.result.current.confirmation.onConfirm())

    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('terminal-1'))
    expect(hook.result.current.confirmation.pendingTabID).toBeNull()
  })

  it('closes an untracked tab without confirmation', async () => {
    const closeTab = vi.fn(async () => {})
    useAppStore.setState({ closeTab })
    const hook = renderHook(() => useTabCloseCoordinator())

    act(() => hook.result.current.requestClose('missing'))

    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('missing'))
    expect(hook.result.current.confirmation.pendingTabID).toBeNull()
  })
})
