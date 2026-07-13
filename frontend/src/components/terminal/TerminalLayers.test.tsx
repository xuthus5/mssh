import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const terminalLayer = vi.hoisted(() => ({ fail: false }))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div role="dialog">{children}</div> : null,
  AlertDialogAction: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} />,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/terminal/TerminalTab', () => ({
  TerminalTab: ({ focusRequest }: { focusRequest: { sequence: number; targetTerminalID?: string | null } }) => {
    if (terminalLayer.fail) throw new Error('terminal failed')
    return <div data-testid="focus-request">{focusRequest.sequence}:{focusRequest.targetTerminalID ?? 'none'}</div>
  },
}))
vi.mock('@/components/terminal/PlaybackTab', () => ({ PlaybackTab: () => null }))
vi.mock('@/components/file/FilePanel', () => ({ default: () => null }))
vi.mock('@/hooks/useFileTransfer', () => ({ useFileTransfer: vi.fn() }))

import { TerminalLayers } from '@/components/terminal/TerminalLayers'
import { useAppStore } from '@/store/appStore'
import { ToastContainer } from '@/components/ui/toast'
import { logger } from '@/lib/logger'

describe('TerminalLayers focus targeting', () => {
  beforeEach(() => {
    terminalLayer.fail = false
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'Terminal', type: 'terminal', terminalId: 'primary-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      activePaneId: 'split-1',
      focusRequest: { id: '', sequence: 0 },
      connectionStatus: {},
      recordingState: {},
    })
  })

  it('freezes one pane target for each tab focus sequence', async () => {
    render(<TerminalLayers />)
    act(() => useAppStore.setState({ focusRequest: { id: 'tab-1', sequence: 1 } }))
    await waitFor(() => expect(screen.getByTestId('focus-request')).toHaveTextContent('1:split-1'))

    act(() => useAppStore.setState({ activePaneId: 'primary-1' }))
    expect(screen.getByTestId('focus-request')).toHaveTextContent('1:split-1')

    act(() => useAppStore.setState({ focusRequest: { id: 'tab-1', sequence: 2 } }))
    await waitFor(() => expect(screen.getByTestId('focus-request')).toHaveTextContent('2:primary-1'))
  })

  it('links a persistent terminal panel to its dynamic tab', () => {
    render(<TerminalLayers />)

    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('id', 'dynamic-panel-tab-1')
    expect(panel).toHaveAttribute('aria-labelledby', 'dynamic-tab-tab-1')
  })

  it('confirms and reports an active connection close from the error boundary', async () => {
    const closeTab = vi.fn(async () => { throw new Error('connection lost') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    terminalLayer.fail = true
    useAppStore.setState({ connectionStatus: { 'primary-1': 'connected' }, closeTab })
    render(<><TerminalLayers /><ToastContainer /></>)

    await userEvent.click(screen.getByRole('button', { name: '关闭标签' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('关闭活动连接？')
    expect(closeTab).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '关闭连接' }))
    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('tab-1'))
    expect(await screen.findByText('关闭标签失败: connection lost')).toBeInTheDocument()
    expect(screen.getByText('终端渲染失败').closest('[role="alert"]')).toBeInTheDocument()
  })
})
