import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/session/SessionAssetCenter', () => ({ SessionAssetCenter: () => <div>会话资产工作区</div> }))
vi.mock('@/components/layout/Sidebar', () => ({ default: () => null }))
vi.mock('@/components/layout/StatusBar', () => ({ default: () => null }))
vi.mock('@/components/layout/WindowTitleBar', () => ({ WindowTitleBar: () => null }))
vi.mock('@/components/layout/ConnectDialog', () => ({ ConnectDialog: () => null }))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({ SessionWorkspaceProvider: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/components/terminal/TerminalTab', () => ({ TerminalTab: () => <div>terminal</div> }))
vi.mock('@/components/terminal/PlaybackTab', () => ({ PlaybackTab: () => <div>playback</div> }))

import App, { EmptyWorkspace } from '@/App'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'
import { useToastStore } from '@/components/ui/toast'

afterEach(() => {
  cleanup()
  useToastStore.setState({ toasts: [] })
  vi.restoreAllMocks()
})

describe('EmptyWorkspace', () => {
  it('shows welcome only before the first workspace entry', () => {
    const view = render(<EmptyWorkspace entered={false} workspace="sessions" />)
    expect(screen.getByText('Secure Shell Client & Session Manager')).toBeInTheDocument()
    view.rerender(<EmptyWorkspace entered workspace="sessions" />)
    expect(screen.queryByText('Secure Shell Client & Session Manager')).not.toBeInTheDocument()
    expect(screen.getByText('会话资产工作区')).toBeInTheDocument()
  })

  it('does not restore welcome when macros are selected', () => {
    render(<EmptyWorkspace entered workspace="macros" />)
    expect(screen.queryByText('Secure Shell Client & Session Manager')).not.toBeInTheDocument()
    expect(screen.getByLabelText('宏工作区')).toBeInTheDocument()
  })

  it('consumes a rejected Ctrl+W close and shows an error toast', async () => {
    const closeTab = vi.fn(async () => { throw new Error('connection lost') })
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const unhandledRejection = vi.fn((event: PromiseRejectionEvent) => event.preventDefault())
    window.addEventListener('unhandledrejection', unhandledRejection)
    useAppStore.setState({
      tabs: [{ id: 'playback-1', title: 'Playback', type: 'playback' }],
      activeTabId: 'playback-1',
      hasEnteredWorkspace: false,
      connectionStatus: {},
      recordingState: {},
      closeTab,
    })

    render(<App />)
    fireEvent.keyDown(document.body, { key: 'w', ctrlKey: true })

    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('playback-1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('关闭标签失败: connection lost')
    expect(logError).toHaveBeenCalledWith(
      'close tab failed',
      expect.objectContaining({ tabId: 'playback-1', error: expect.any(Error) }),
    )
    expect(unhandledRejection).not.toHaveBeenCalled()
    window.removeEventListener('unhandledrejection', unhandledRejection)
  })
})
