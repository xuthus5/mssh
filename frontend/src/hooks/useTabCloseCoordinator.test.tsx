import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTabCloseCoordinator } from '@/hooks/useTabCloseCoordinator'
import { useToastStore } from '@/components/ui/toast'
import { useAppStore } from '@/store/appStore'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

const persist = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/terminalClosePreference', () => ({ persistTerminalClosePreference: persist }))

describe('useTabCloseCoordinator', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [],
      connectionStatus: {},
      recordingState: {},
      closeTab: vi.fn(async () => {}),
    })
    useTerminalBehaviorStore.setState({ autoCloseTerminalOnExit: false })
    persist.mockReset().mockResolvedValue(undefined)
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
    await waitFor(() => expect(hook.result.current.confirmation.pendingTabID).toBeNull())
  })

  it('closes an untracked tab without confirmation', async () => {
    const closeTab = vi.fn(async () => {})
    useAppStore.setState({ closeTab })
    const hook = renderHook(() => useTabCloseCoordinator())

    act(() => hook.result.current.requestClose('missing'))

    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('missing'))
    expect(hook.result.current.confirmation.pendingTabID).toBeNull()
  })

  it('keeps dialog open and shows close failures without toast', async () => {
    const closeTab = vi.fn(async () => { throw new Error('connection lost') })
    useToastStore.setState({ toasts: [] })
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      connectionStatus: { 'term-1': 'connected' },
      closeTab,
    })
    const hook = renderHook(() => useTabCloseCoordinator())
    act(() => hook.result.current.requestClose('terminal-1'))
    act(() => hook.result.current.confirmation.onConfirm())
    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('terminal-1'))
    await waitFor(() => expect(hook.result.current.confirmation.closeError).toContain('关闭标签失败: connection lost'))
    expect(hook.result.current.confirmation.pendingTabID).toBe('terminal-1')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('closes an active terminal without confirmation when auto-close is enabled', async () => {
    const closeTab = vi.fn(async () => {})
    useTerminalBehaviorStore.setState({ autoCloseTerminalOnExit: true })
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      connectionStatus: { 'term-1': 'connected' },
      closeTab,
    })
    const hook = renderHook(() => useTabCloseCoordinator())

    act(() => hook.result.current.requestClose('terminal-1'))

    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('terminal-1'))
    expect(hook.result.current.confirmation.pendingTabID).toBeNull()
  })

  it('persists the remember preference and closes when confirmed', async () => {
    const closeTab = vi.fn(async () => {})
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      connectionStatus: { 'term-1': 'connected' },
      closeTab,
    })
    const hook = renderHook(() => useTabCloseCoordinator())
    act(() => hook.result.current.requestClose('terminal-1'))
    expect(hook.result.current.confirmation.pendingTabID).toBe('terminal-1')
    act(() => hook.result.current.confirmation.setRemember(true))
    act(() => hook.result.current.confirmation.onConfirmWithPreference())

    await waitFor(() => expect(persist).toHaveBeenCalledWith(true))
    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('terminal-1'))
    await waitFor(() => expect(hook.result.current.confirmation.pendingTabID).toBeNull())
  })

  it('closes all terminal tabs after a single confirmation', async () => {
    const closeTab = vi.fn(async () => {})
    useAppStore.setState({
      tabs: [
        { id: 'terminal-1', title: 'One', type: 'terminal', terminalId: 'term-1', sessionId: 1 },
        { id: 'terminal-2', title: 'Two', type: 'terminal', terminalId: 'term-2', sessionId: 2 },
      ],
      connectionStatus: { 'term-1': 'connected', 'term-2': 'connected' },
      closeTab,
    })
    const hook = renderHook(() => useTabCloseCoordinator())
    act(() => hook.result.current.requestCloseAll())
    expect(hook.result.current.confirmation.pendingTabID).toBe('__all__')
    act(() => hook.result.current.confirmation.onConfirm())

    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('terminal-1'))
    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('terminal-2'))
    await waitFor(() => expect(hook.result.current.confirmation.pendingTabID).toBeNull())
  })
})
